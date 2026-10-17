// -----------------------------------------------------------------------------
// The real-time feed of a Sense monitor: ONE WebSocket
// (wss://clientrt.sense.com/monitors/<id>/realtimefeed?access_token=...),
// read-only, reopened with an exponential backoff and jitter. Messages are
// JSON `{ type, payload }`, or MessagePack frames of three values (type,
// epoch, payload) as sense-energy reads them; only `realtime_update` and
// `error` matter.
//
// The token travels in the URL: the URL is never logged, and error texts
// coming from the socket are scrubbed.
//
// Ported from sense-energy (scottbonline/sense, MIT): the URL, the message
// types and the frame layout.
// -----------------------------------------------------------------------------

import {
  LIVE_HANDSHAKE_FAILURES,
  LIVE_RECONNECT,
  LIVE_SILENCE,
  MSGPACK_MAX_BYTES,
  USER_AGENT,
  WS_URL,
} from '../constants.js';
import { decode, decodeAll } from './msgpack.js';

const OPEN = 1;

/** Remove any token from a text before it reaches a log. */
export const scrub = (text) => String(text ?? '').replace(/(access_token=)[^&\s"']+/gi, '$1***');

/** The default socket factory: Node's global WebSocket (undici). */
function defaultSocketFactory(url) {
  return new globalThis.WebSocket(url, { headers: { 'User-Agent': USER_AGENT } });
}

/** The messages of ONE self-contained frame: a JSON text, or MessagePack (type, epoch, payload) triples. */
export function messagesOf(data) {
  if (typeof data === 'string') {
    try {
      const message = JSON.parse(data);
      return message && typeof message === 'object' ? [message] : [];
    } catch {
      return [];
    }
  }
  let values;
  try {
    values = decodeAll(data);
  } catch {
    return [];
  }
  const messages = [];
  for (let i = 0; i + 2 < values.length; i += 3) {
    messages.push({ type: values[i], epoch: values[i + 1], payload: values[i + 2] });
  }
  return messages;
}

/** An `error` message that says the token is not (or no longer) accepted. */
export function isAuthError(payload) {
  if (!payload || typeof payload !== 'object') {
    return true;
  }
  return payload.authorized === false || /auth|token|expired/i.test(String(payload.error_reason));
}

export class RealtimeFeed {
  constructor({
    monitorId,
    getToken,
    onUpdate,
    onStatus = () => {},
    onAuthError = async () => {},
    logger = console,
    socketFactory = defaultSocketFactory,
    timers = { setTimeout, clearTimeout },
    random = Math.random,
  }) {
    this.monitorId = monitorId;
    this.getToken = getToken;
    this.onUpdate = onUpdate;
    this.onStatus = onStatus;
    this.onAuthError = onAuthError;
    this.logger = logger;
    this.socketFactory = socketFactory;
    this.timers = timers;
    this.random = random;
    this.socket = undefined;
    this.attempts = 0;
    this.handshakeFailures = 0;
    this.retryTimer = undefined;
    this.silenceTimer = undefined;
    this.stopped = true;
    this.connected = false;
    this.received = false;
    this.pendingBytes = new Uint8Array(0);
    this.pendingValues = [];
    this.badFrameLogged = false;
  }

  start() {
    this.stopped = false;
    this.attempts = 0;
    this.open();
  }

  stop() {
    this.stopped = true;
    this.timers.clearTimeout(this.retryTimer);
    this.retryTimer = undefined;
    this.close();
  }

  setConnected(connected) {
    if (this.connected !== connected) {
      this.connected = connected;
      this.onStatus(connected);
    }
  }

  close() {
    this.timers.clearTimeout(this.silenceTimer);
    this.silenceTimer = undefined;
    if (this.socket) {
      const socket = this.socket;
      this.socket = undefined;
      try {
        socket.close();
      } catch {
        // already closed
      }
    }
    this.setConnected(false);
  }

  open() {
    if (this.stopped || this.socket) {
      return;
    }
    const token = this.getToken();
    if (!token) {
      this.scheduleReconnect();
      return;
    }
    let socket;
    try {
      socket = this.socketFactory(WS_URL(this.monitorId, token));
    } catch (err) {
      this.logger.warn(`Sense real-time feed failed to open: ${scrub(err?.message)}`);
      this.scheduleReconnect();
      return;
    }
    this.socket = socket;
    this.received = false;
    this.pendingBytes = new Uint8Array(0);
    this.pendingValues = [];
    try {
      socket.binaryType = 'arraybuffer';
    } catch {
      // not settable on this socket
    }
    this.watch();
    socket.onmessage = (event) => {
      if (this.socket === socket) {
        this.handle(event?.data);
      }
    };
    socket.onerror = (event) => {
      this.logger.warn(`Sense real-time feed error: ${scrub(event?.message ?? 'unknown')}`);
      // Node 22 may report a refused handshake by an error without any close
      // event: a socket that is not open is then handled as closed.
      if (socket.readyState !== undefined && socket.readyState !== OPEN) {
        this.closed(socket, { code: 1006 });
      }
    };
    socket.onclose = (event) => this.closed(socket, event);
  }

  /** The socket is gone (close event, or an error on a socket that is not open). */
  closed(socket, event) {
    if (this.socket !== socket) {
      return; // closed by us, or already handled
    }
    this.socket = undefined;
    try {
      socket.close();
    } catch {
      // already closed
    }
    this.timers.clearTimeout(this.silenceTimer);
    this.silenceTimer = undefined;
    this.setConnected(false);
    this.logger.warn(`Sense real-time feed closed (${event?.code ?? '?'})`);
    if (!this.received) {
      // Refused before the first message: a 401 at the handshake looks like
      // this. Twice in a row, the token is suspected and renewed.
      this.handshakeFailures += 1;
      if (this.handshakeFailures >= LIVE_HANDSHAKE_FAILURES) {
        this.handshakeFailures = 0;
        this.authFailed();
      }
    }
    this.scheduleReconnect();
  }

  /** Reopen a feed that went silent (a half-open TCP connection never closes by itself). */
  watch() {
    this.timers.clearTimeout(this.silenceTimer);
    this.silenceTimer = this.timers.setTimeout(() => {
      this.silenceTimer = undefined;
      this.logger.warn('Sense real-time feed silent: reopening');
      this.close();
      this.scheduleReconnect();
    }, LIVE_SILENCE);
  }

  authFailed() {
    Promise.resolve()
      .then(() => this.onAuthError())
      .catch((err) => this.logger.warn(`Sense token renewal failed: ${scrub(err?.message)}`));
  }

  handle(data) {
    this.received = true;
    this.handshakeFailures = 0;
    this.watch();
    for (const message of this.frameMessages(data)) {
      if (message.type === 'realtime_update') {
        this.attempts = 0;
        this.setConnected(true);
        if (message.payload && typeof message.payload === 'object') {
          this.onUpdate(message.payload);
        }
      } else if (message.type === 'error') {
        const auth = isAuthError(message.payload);
        this.logger.warn(
          `Sense real-time feed refused: ${scrub(message.payload?.error_reason ?? 'error').slice(0, 120)}`,
        );
        this.close();
        if (auth) {
          this.authFailed();
        }
        this.scheduleReconnect();
        return;
      }
    }
  }

  /**
   * The messages of a frame. MessagePack values and the bytes of a value cut
   * at the end of a frame are kept for the next one (a message may span two
   * frames); more than MSGPACK_MAX_BYTES pending is refused.
   */
  frameMessages(data) {
    if (typeof data === 'string') {
      const messages = messagesOf(data);
      if (messages.length === 0) {
        this.badFrame('not JSON');
      }
      return messages;
    }
    let bytes;
    if (data instanceof Uint8Array) {
      bytes = data;
    } else if (data instanceof ArrayBuffer) {
      bytes = new Uint8Array(data);
    } else {
      this.badFrame('unknown frame type');
      return [];
    }
    if (this.pendingBytes.length + bytes.length > MSGPACK_MAX_BYTES) {
      this.pendingBytes = new Uint8Array(0);
      this.pendingValues = [];
      this.badFrame('frame too large');
      return [];
    }
    const joined = new Uint8Array(this.pendingBytes.length + bytes.length);
    joined.set(this.pendingBytes);
    joined.set(bytes, this.pendingBytes.length);
    let decoded;
    try {
      decoded = decode(joined);
    } catch {
      this.pendingBytes = new Uint8Array(0);
      this.pendingValues = [];
      this.badFrame('unreadable MessagePack');
      return [];
    }
    this.pendingBytes = decoded.rest;
    this.pendingValues.push(...decoded.values);
    const messages = [];
    while (this.pendingValues.length >= 3) {
      const [type, epoch, payload] = this.pendingValues.splice(0, 3);
      messages.push({ type, epoch, payload });
    }
    return messages;
  }

  /** An unusable frame is logged once per feed, never flooding the logs. */
  badFrame(reason) {
    if (!this.badFrameLogged) {
      this.badFrameLogged = true;
      this.logger.warn(`Sense real-time frame ignored (${reason}); the next ones are not logged`);
    }
  }

  scheduleReconnect() {
    if (this.stopped || this.retryTimer) {
      return;
    }
    const ceiling = Math.min(LIVE_RECONNECT.max, LIVE_RECONNECT.base * 2 ** this.attempts);
    // Jitter: between half and the whole of the backoff, so that many
    // integrations cut at once do not come back at the same second.
    const delay = Math.round(ceiling / 2 + (this.random() * ceiling) / 2);
    this.attempts += 1;
    this.retryTimer = this.timers.setTimeout(() => {
      this.retryTimer = undefined;
      this.open();
    }, delay);
  }
}
