import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LIVE_SILENCE } from '../src/constants.js';
import { RealtimeFeed, isAuthError, messagesOf, scrub } from '../src/sense/live.js';
import { createSocketFactory, encode } from './helpers/fakeSocket.js';
import { createFakeTimers } from './helpers/fakeTimers.js';
import { realtime } from './fixtures/sense.js';

const quiet = { info() {}, warn() {}, error() {}, debug() {} };

function setup({ token = 'tok', random = () => 1 } = {}) {
  const { sockets, factory, last } = createSocketFactory();
  const timers = createFakeTimers();
  const updates = [];
  const statuses = [];
  const auth = { calls: 0 };
  const logs = [];
  const feed = new RealtimeFeed({
    monitorId: '123456',
    getToken: () => token,
    onUpdate: (p) => updates.push(p),
    onStatus: (s) => statuses.push(s),
    onAuthError: async () => {
      auth.calls += 1;
    },
    logger: { ...quiet, warn: (m) => logs.push(m) },
    socketFactory: factory,
    timers,
    random,
  });
  return { feed, sockets, last, timers, updates, statuses, auth, logs };
}

const retries = (timers) => timers.timeouts().filter((t) => t.ms !== LIVE_SILENCE);

test('one socket on the monitor feed, updates delivered, backoff with jitter', async () => {
  const { feed, sockets, last, timers, updates, statuses } = setup({ random: () => 0 });
  feed.start();
  assert.equal(sockets.length, 1);
  assert.equal(
    last().url,
    'wss://clientrt.sense.com/monitors/123456/realtimefeed?access_token=tok',
  );
  assert.equal(last().binaryType, 'arraybuffer');
  last().receive({ type: 'hello', payload: { online: true } });
  assert.deepEqual(statuses, [], 'connected on the first realtime update');
  last().receive({ type: 'realtime_update', payload: realtime() });
  assert.equal(updates.length, 1);
  assert.equal(updates[0].w, 2500.4);
  assert.deepEqual(statuses, [true]);
  feed.start(); // a second start never opens a second socket
  assert.equal(sockets.length, 1);
  // Dropped: reconnect between half and the whole of 5 s (random 0: half).
  last().drop();
  assert.deepEqual(statuses, [true, false]);
  assert.equal(retries(timers)[0].ms, 2500);
  await timers.runTimeouts((t) => t.ms !== LIVE_SILENCE);
  assert.equal(sockets.length, 2);
  last().receive({ type: 'hello' });
  last().drop();
  assert.equal(retries(timers)[0].ms, 5000, 'the backoff doubles');
  feed.stop();
  assert.equal(timers.pending.size, 0);
  await timers.runTimeouts();
  assert.equal(sockets.length, 2, 'no reconnection once stopped');
});

test('the backoff stops at five minutes', async () => {
  const { feed, last, timers } = setup();
  feed.start();
  for (let i = 0; i < 10; i += 1) {
    last().receive({ type: 'hello' });
    last().drop();
    await timers.runTimeouts((t) => t.ms !== LIVE_SILENCE);
  }
  last().receive({ type: 'hello' });
  last().drop();
  assert.equal(retries(timers)[0].ms, 5 * 60_000);
  feed.stop();
});

test('MessagePack frames are read like JSON ones', () => {
  const { feed, last, updates } = setup();
  feed.start();
  last().receiveBinary(
    Uint8Array.from([...encode('realtime_update'), ...encode(1), ...encode(realtime())]),
  );
  assert.equal(updates.length, 1);
  assert.equal(updates[0].solar_w, 1800.6);
  feed.stop();
});

test('a refused token: renewal asked, then a reconnection', async () => {
  const { feed, sockets, last, timers, auth } = setup();
  feed.start();
  last().receive({ type: 'error', payload: { authorized: false, error_reason: 'Unauthorized' } });
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(auth.calls, 1);
  assert.equal(last().closed, true);
  await timers.runTimeouts((t) => t.ms !== LIVE_SILENCE);
  assert.equal(sockets.length, 2);
  // Closed twice before any message (a 401 at the handshake): renewal too.
  last().drop();
  assert.equal(auth.calls, 1, 'once could be the network');
  await timers.runTimeouts((t) => t.ms !== LIVE_SILENCE);
  last().drop();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(auth.calls, 2);
  feed.stop();
});

test('a silent feed is reopened', async () => {
  const { feed, sockets, timers } = setup();
  feed.start();
  sockets[0].receive({ type: 'hello' });
  await timers.runTimeouts((t) => t.ms === LIVE_SILENCE);
  assert.equal(sockets[0].closed, true);
  await timers.runTimeouts((t) => t.ms !== LIVE_SILENCE);
  assert.equal(sockets.length, 2);
  feed.stop();
});

test('no token yet: no socket, a retry', () => {
  const { feed, sockets, timers } = setup({ token: '' });
  feed.start();
  assert.equal(sockets.length, 0);
  assert.equal(timers.timeouts().length, 1);
  feed.stop();
});

test('the token never reaches a log', () => {
  assert.equal(
    scrub('failed wss://clientrt.sense.com/monitors/1/realtimefeed?access_token=secret.jwt'),
    'failed wss://clientrt.sense.com/monitors/1/realtimefeed?access_token=***',
  );
  const { feed, last, logs } = setup();
  feed.start();
  last().onerror({ message: 'boom ?access_token=tok' });
  assert.ok(logs.every((l) => !l.includes('=tok')));
  feed.stop();
});

test('frames and auth errors', () => {
  assert.deepEqual(messagesOf('not json'), []);
  assert.deepEqual(messagesOf('{"type":"hello"}'), [{ type: 'hello' }]);
  assert.deepEqual(messagesOf(new Uint8Array([0xc1])), []);
  assert.equal(isAuthError(undefined), true);
  assert.equal(isAuthError({ authorized: false }), true);
  assert.equal(isAuthError({ error_reason: 'Token expired' }), true);
  assert.equal(isAuthError({ error_reason: 'Monitor offline' }), false);
});

test('a MessagePack message split over two frames is joined', () => {
  const { feed, last, updates } = setup();
  feed.start();
  const bytes = Uint8Array.from([
    ...encode('realtime_update'),
    ...encode(1),
    ...encode(realtime()),
  ]);
  last().receiveBinary(bytes.subarray(0, 30));
  assert.equal(updates.length, 0);
  last().receiveBinary(bytes.subarray(30));
  assert.equal(updates.length, 1);
  assert.equal(updates[0].w, 2500.4);
  feed.stop();
});

test('unusable frames: dropped, logged once, too large refused', () => {
  const { feed, last, updates, logs } = setup();
  feed.start();
  last().receive('ignored');
  last().onmessage({ data: 'not json' });
  last().onmessage({ data: 'still not json' });
  last().receiveBinary(Uint8Array.from([0xc1]));
  last().receiveBinary(new Uint8Array(1024 * 1024 + 1).fill(0xdc));
  assert.equal(logs.filter((l) => l.includes('frame ignored')).length, 1);
  last().receiveBinary(
    Uint8Array.from([...encode('realtime_update'), ...encode(1), ...encode(realtime())]),
  );
  assert.equal(updates.length, 1, 'the feed goes on after them');
  feed.stop();
});

test('Node 22: an error on a socket that is not open counts as a closure', async () => {
  const { feed, sockets, last, timers, auth } = setup();
  feed.start();
  last().fail();
  assert.equal(retries(timers).length, 1, 'a reconnection is scheduled');
  last().onclose?.({ code: 1006 }); // a late close event changes nothing
  assert.equal(retries(timers).length, 1);
  await timers.runTimeouts((t) => t.ms !== LIVE_SILENCE);
  assert.equal(sockets.length, 2);
  last().fail();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(auth.calls, 1, 'two refused handshakes: the token is suspected');
  // An error on an open socket waits for its close event.
  await timers.runTimeouts((t) => t.ms !== LIVE_SILENCE);
  last().onerror({ message: 'glitch' });
  assert.equal(last().closed, false);
  feed.stop();
});
