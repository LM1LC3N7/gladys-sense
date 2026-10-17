// -----------------------------------------------------------------------------
// A fake WebSocket for the real-time feed: the test plays Sense's side. Also a
// tiny MessagePack encoder, to send binary frames like recent Sense servers.
// -----------------------------------------------------------------------------

export class FakeSocket {
  constructor(url) {
    this.url = url;
    this.closed = false;
    this.readyState = 1; // OPEN
    this.binaryType = 'blob';
    this.onmessage = null;
    this.onerror = null;
    this.onclose = null;
  }

  close() {
    this.closed = true;
    this.readyState = 3;
  }

  /** Node 22: a refused handshake raises an error, with no close event. */
  fail() {
    this.readyState = 3;
    this.onerror?.({ message: 'Received network error or non-101 status code.' });
  }

  // --- Sense's side -----------------------------------------------------------
  receive(message) {
    this.onmessage?.({ data: JSON.stringify(message) });
  }

  receiveBinary(bytes) {
    this.onmessage?.({
      data: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length),
    });
  }

  drop(code = 1006) {
    this.onclose?.({ code });
  }
}

export function createSocketFactory() {
  const sockets = [];
  return {
    sockets,
    last: () => sockets.at(-1),
    factory: (url) => {
      const socket = new FakeSocket(url);
      sockets.push(socket);
      return socket;
    },
  };
}

/** Encode a value as MessagePack (the subset the tests need). */
export function encode(value) {
  const out = [];
  const bytes = (...b) => out.push(...b);
  const u32 = (n) => bytes((n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff);
  const write = (v) => {
    if (v === null || v === undefined) {
      bytes(0xc0);
    } else if (v === true || v === false) {
      bytes(v ? 0xc3 : 0xc2);
    } else if (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < 128) {
      bytes(v);
    } else if (typeof v === 'number' && Number.isInteger(v) && v >= -32 && v < 0) {
      bytes(v & 0xff);
    } else if (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < 2 ** 32) {
      bytes(0xce);
      u32(v);
    } else if (typeof v === 'number') {
      const buf = Buffer.alloc(8);
      buf.writeDoubleBE(v);
      bytes(0xcb, ...buf);
    } else if (typeof v === 'string') {
      const buf = Buffer.from(v, 'utf8');
      if (buf.length < 32) {
        bytes(0xa0 | buf.length);
      } else {
        bytes(0xd9, buf.length);
      }
      bytes(...buf);
    } else if (Array.isArray(v)) {
      bytes(0xdc, (v.length >> 8) & 0xff, v.length & 0xff);
      v.forEach(write);
    } else {
      const entries = Object.entries(v);
      bytes(0xde, (entries.length >> 8) & 0xff, entries.length & 0xff);
      for (const [k, val] of entries) {
        write(k);
        write(val);
      }
    }
  };
  write(value);
  return Uint8Array.from(out);
}
