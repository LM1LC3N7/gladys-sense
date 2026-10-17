import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appliancesOf, halfHoursOf, liveOf, monitorOf, trendStart } from '../src/sense/model.js';
import { MAX_DEPTH, decode, decodeAll } from '../src/sense/msgpack.js';
import { encode } from './helpers/fakeSocket.js';
import {
  NOW,
  at,
  devicesOverview,
  overview,
  realtime,
  todayUsage,
  usage,
} from './fixtures/sense.js';

test('the monitor, from an overview or an authenticate monitor', () => {
  assert.deepEqual(monitorOf(overview()), {
    id: '123456',
    serial: 'N123A456',
    timeZone: 'America/New_York',
    solar: true,
  });
  assert.equal(monitorOf(overview({ solar: false })).solar, false);
  assert.equal(monitorOf({}, { id: '9' }).id, '9');
});

test('the detected devices: hidden and merged left out, a smart plug kept once', () => {
  assert.deepEqual(appliancesOf(devicesOverview()), [
    { id: 'fridge1', name: 'Fridge', icon: 'fridge' },
    { id: 'always_on', name: 'Always On', icon: 'alwayson' },
    { id: 'plug-new', name: 'Desk plug', icon: 'socket' },
  ]);
  assert.deepEqual(appliancesOf({}), []);
});

test('a realtime update: rounded, non-negative, devices by id', () => {
  const live = liveOf(realtime());
  assert.equal(live.power, 2500);
  assert.equal(live.production, 1801);
  assert.deepEqual(live.voltage, [121.3, 120.9]);
  assert.equal(live.frequency, 59.99);
  assert.equal(live.grid, 700, 'consumed minus produced, signed');
  assert.equal(liveOf(realtime({ w: 500, solar_w: 1800 })).grid, -1300, 'exporting');
  assert.equal(liveOf(realtime({ grid_w: 42.4 })).grid, 42, 'the own value first');
  assert.equal(liveOf({}).grid, null);
  assert.deepEqual(
    [...live.devices],
    [
      ['fridge1', 144],
      ['always_on', 210],
    ],
  );
  const empty = liveOf({ w: -3, devices: [] });
  assert.equal(empty.power, 0);
  assert.equal(empty.devices, undefined, 'no list: the previous powers stay');
  assert.equal(empty.production, null);
  assert.deepEqual(empty.voltage, [null, null]);
  assert.equal(liveOf({ devices: 'nonsense' }).devices, undefined);
});

test('the finished hours become two dated half hours each', () => {
  const intervals = halfHoursOf(todayUsage(), NOW);
  assert.equal(intervals.length, 28, '14 finished hours, the 15th still filling');
  assert.deepEqual(intervals[0], { starts_at: at(0), kwh: 0.5 });
  assert.deepEqual(intervals[1], { starts_at: at(0.5), kwh: 0.5 });
  assert.equal(intervals.at(-1).starts_at, at(13.5));
  // A 25-hour day (fall back): counted from the answer's own start.
  const long = halfHoursOf(usage('2026-11-01T04:00:00.000Z', Array(25).fill(1)), Infinity);
  assert.equal(long.length, 50);
  assert.equal(long.at(-1).starts_at, '2026-11-02T04:30:00.000Z');
  // Garbage is skipped, a missing answer gives nothing.
  assert.equal(
    halfHoursOf(usage('2026-10-15T04:00:00.000Z', [1, null, -1, 'x']), Infinity).length,
    2,
  );
  assert.deepEqual(halfHoursOf(undefined, NOW), []);
});

test('the start of a trend is the UTC instant without zone', () => {
  assert.equal(trendStart(NOW), `${at(14 + 1 / 3).slice(0, 16)}:00`);
  assert.equal(trendStart(Date.parse('2026-10-16T18:20:00.123Z')), '2026-10-16T18:20:00');
});

test('MessagePack: the Sense frame layout and the usual types', () => {
  const frame = Uint8Array.from([
    ...encode('realtime_update'),
    ...encode(1792000000),
    ...encode({ w: 1234.5, hz: 60, voltage: [120.5, 121], ok: true, none: null, n: -3 }),
  ]);
  const [type, epoch, payload] = decodeAll(frame);
  assert.equal(type, 'realtime_update');
  assert.equal(epoch, 1792000000);
  assert.deepEqual(payload, {
    w: 1234.5,
    hz: 60,
    voltage: [120.5, 121],
    ok: true,
    none: null,
    n: -3,
  });
  // Ints, floats, strings and containers of every width.
  assert.deepEqual(
    decodeAll(
      Uint8Array.from([
        0xcc, 0xff, 0xcd, 0x01, 0x00, 0xd0, 0x80, 0xd1, 0xff, 0x00, 0xd2, 0xff, 0xff, 0xff, 0xff,
        0xcf, 0, 0, 0, 0, 0, 0, 0, 7, 0xd3, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xfe, 0xca,
        0x3f, 0xc0, 0, 0, 0xda, 0, 1, 0x61, 0x92, 1, 2, 0x81, 0xa1, 0x6b, 0xc2, 0xd4, 1, 2, 0xc4, 2,
        9, 9,
      ]),
    ),
    [
      255,
      256,
      -128,
      -256,
      -1,
      7,
      -2,
      1.5,
      'a',
      [1, 2],
      { k: false },
      null,
      Uint8Array.from([9, 9]),
    ],
  );
  // A truncated value at the end is dropped, a prototype key ignored.
  assert.deepEqual(decodeAll(Uint8Array.from([0x01, 0xa3, 0x61])), [1]);
  assert.deepEqual(
    Object.keys(decodeAll(Uint8Array.from([0x81, 0xa9, ...Buffer.from('__proto__'), 1]))[0]),
    [],
  );
  assert.throws(() => decodeAll(Uint8Array.from([0xc1])), /Invalid MessagePack/);
  // The bytes of a cut value are returned, to be completed by the next frame.
  const cut = decode(Uint8Array.from([0x01, 0xa3, 0x61]));
  assert.deepEqual(cut.values, [1]);
  assert.deepEqual([...cut.rest], [0xa3, 0x61]);
  assert.deepEqual(decode(Uint8Array.from([...cut.rest, 0x62, 0x63])).values, ['abc']);
  // Nesting is bounded.
  const deep = Uint8Array.from([...Array(MAX_DEPTH + 2).fill(0x91), 1]);
  assert.throws(() => decodeAll(deep), /nested too deep/);
  assert.deepEqual(decodeAll(Uint8Array.from([0x91, 0x91, 1])), [[[1]]]);
});
