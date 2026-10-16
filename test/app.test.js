// -----------------------------------------------------------------------------
// The integration against the SDK's fake Gladys, a fake Sense API and a fake
// real-time socket.
// -----------------------------------------------------------------------------

import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { SenseApp } from '../src/app.js';
import {
  ACTIONS,
  BAD_CREDENTIALS_RETRY,
  DEVICES_INTERVAL,
  LIVE_SILENCE,
  LOGIN_RETRY,
  SESSION_KEY,
  TRENDS_INTERVAL,
} from '../src/constants.js';
import { RealtimeFeed } from '../src/sense/live.js';
import { installFetch, json } from './helpers/fakeFetch.js';
import { createSocketFactory } from './helpers/fakeSocket.js';
import { createFakeTimers } from './helpers/fakeTimers.js';
import {
  MONITOR_ID,
  NOW,
  TODAY_START,
  YESTERDAY_START,
  at,
  auth,
  devicesOverview,
  mfaChallenge,
  overview,
  realtime,
  solarUsage,
  todayUsage,
  yesterdayUsage,
} from './fixtures/sense.js';

const quiet = {
  info() {},
  warn: (...a) => process.env.DEBUG_TEST && console.error(...a),
  error() {},
  debug() {},
};

let fake;
afterEach(() => fake?.restore());

const MONITOR = `ext:sense:monitor:${MONITOR_ID}`;
const CONFIG = { email: 'Me@Example.com ', password: 'pw' };

function setup({ config = CONFIG, routes = {}, solar = true, devices = [] } = {}) {
  fake = installFetch({
    authenticate: () => json(auth()),
    overview: () => json(overview({ solar })),
    devices: () => json(devicesOverview()),
    usage: ({ query }) =>
      json(Date.parse(query.start) < Date.parse(TODAY_START) ? yesterdayUsage() : todayUsage()),
    solar: () => json(solarUsage()),
    renew: () => json({ access_token: 'acc-2', refresh_token: 'ref-2', user_id: 4242 }),
    ...routes,
  });
  const gladys = createFakeGladys({ selector: 'sense', config, devices });
  const timers = createFakeTimers();
  const clock = { now: NOW };
  const sockets = createSocketFactory();
  const app = new SenseApp({
    gladys,
    logger: quiet,
    now: () => clock.now,
    timers,
    random: () => 1,
    feedFactory: (options) => new RealtimeFeed({ ...options, socketFactory: sockets.factory }),
  });
  gladys.onScanRequest(() => app.scan());
  gladys.onDeviceCreated((device) => app.deviceCreated(device));
  gladys.onAction(ACTIONS.TEST, () => app.testConnection());
  gladys.onAction(ACTIONS.MFA, (fields) => app.verifyMfa(fields));
  return { app, gladys, timers, clock, sockets };
}

const feature = (key) => `${MONITOR}:${key}`;
const storedSession = (gladys) => JSON.parse(gladys.fake.config[SESSION_KEY]);

test('no credentials: the status says so, nothing is called', async () => {
  const { app, gladys, timers } = setup({ config: {} });
  await app.start({});
  assert.equal(gladys.fake.connectionStatus.connected, false);
  assert.match(gladys.fake.connectionStatus.message.fr, /mot de passe/);
  assert.equal(fake.calls.length, 0);
  assert.equal(timers.pending.size, 0);
});

test('start: sign-in, monitor device, trends, one real-time socket, session kept', async () => {
  const { app, gladys, timers, sockets } = setup();
  await app.start(CONFIG);
  assert.deepEqual(fake.named('authenticate')[0].form, { email: 'me@example.com', password: 'pw' });
  const [device] = gladys.fake.discoveredDevices;
  assert.equal(device.external_id, MONITOR);
  assert.equal(device.name, 'Sense N123A456');
  const keys = device.features.map((f) => f.external_id.split(':').at(-1));
  assert.deepEqual(keys, [
    'power',
    'voltage_l1',
    'voltage_l2',
    'frequency',
    'consumption',
    'today_consumption',
    'production_power',
    'today_production',
    'today_from_grid',
    'today_to_grid',
  ]);
  assert.ok(device.features.every((f) => f.read_only));
  assert.equal(gladys.fake.lastState(feature('today_consumption')), 14.4);
  assert.equal(gladys.fake.lastState(feature('today_production')), 11.3);
  assert.equal(gladys.fake.lastState(feature('today_from_grid')), 6.2);
  assert.equal(gladys.fake.lastState(feature('today_to_grid')), 3.1);
  // Today, its solar side, and yesterday once.
  assert.deepEqual(
    fake.calls.map((c) => c.name),
    ['authenticate', 'overview', 'usage', 'solar', 'usage'],
  );
  assert.ok(fake.calls.slice(1).every((c) => c.headers.Authorization === 'bearer acc-1'));
  assert.equal(sockets.sockets.length, 1);
  assert.match(sockets.sockets[0].url, /\/monitors\/123456\/realtimefeed\?access_token=acc-1$/);
  assert.deepEqual(
    timers.intervals().map((t) => t.ms),
    [TRENDS_INTERVAL],
    'no device list without the option',
  );
  assert.equal(gladys.fake.connectionStatus.connected, true);
  assert.match(gladys.fake.connectionStatus.message.en, /Sense N123A456/);
  const session = storedSession(gladys);
  assert.equal(session.email, 'me@example.com');
  assert.equal(session.refresh_token, 'ref-1');
  assert.equal(session.monitor_id, MONITOR_ID);
  await app.stop();
  assert.equal(timers.pending.size, 0);
  assert.equal(sockets.sockets[0].closed, true);
});

test('a restart reuses the stored session: no new sign-in', async () => {
  const first = setup();
  await first.app.start(CONFIG);
  const stored = first.gladys.fake.config[SESSION_KEY];
  await first.app.stop();
  fake.restore();
  const { app } = setup();
  await app.start({ ...CONFIG, [SESSION_KEY]: stored });
  assert.equal(fake.named('authenticate').length, 0);
  assert.equal(fake.calls[0].headers['x-sense-device-id'], JSON.parse(stored).device_id);
  await app.stop();
  // Another e-mail: the session is not reused.
  fake.restore();
  const other = setup();
  await other.app.start({ ...CONFIG, email: 'other@example.com', [SESSION_KEY]: stored });
  assert.equal(fake.named('authenticate').length, 1);
  await other.app.stop();
});

test('the 30-minute consumption goes to the energy monitoring once the device exists', async () => {
  const { app, gladys } = setup();
  await app.start(CONFIG);
  assert.equal(gladys.fake.publishedEnergyConsumption.length, 0, 'not created yet: 404, quiet');
  await gladys.fake.deviceCreated(gladys.fake.discoveredDevices[0]);
  const [batch] = gladys.fake.publishedEnergyConsumption;
  assert.equal(batch.device_feature_external_id, feature('consumption'));
  assert.equal(batch.intervals.length, 48 + 28, 'yesterday whole, today up to the last hour');
  assert.deepEqual(batch.intervals[0], { starts_at: YESTERDAY_START, kwh: 0.25 });
  assert.deepEqual(batch.intervals.at(-1), { starts_at: at(13.5), kwh: 0.5 });
  const stored = gladys.fake.energyConsumption[feature('consumption')];
  assert.equal(stored.length, 76);
  await app.stop();
});

test('without solar: no production features, no solar call', async () => {
  const { app, gladys } = setup({ solar: false });
  await app.start(CONFIG);
  const keys = gladys.fake.discoveredDevices[0].features.map((f) =>
    f.external_id.split(':').at(-1),
  );
  assert.ok(!keys.includes('production_power') && !keys.includes('today_to_grid'));
  assert.equal(fake.named('solar').length, 0);
  await app.stop();
});

test('real time: throttled states, budgeted detected devices', async () => {
  const { app, gladys, clock, sockets, timers } = setup({
    config: { ...CONFIG, appliances: true },
  });
  await app.start({ ...CONFIG, appliances: true });
  const names = gladys.fake.discoveredDevices.map((d) => d.name);
  assert.deepEqual(names, ['Sense N123A456', 'Sense Fridge', 'Sense Always On', 'Sense Desk plug']);
  assert.equal(
    gladys.fake.discoveredDevices[1].external_id,
    `ext:sense:appliance:${MONITOR_ID}_fridge1`,
  );
  assert.deepEqual(
    timers.intervals().map((t) => t.ms),
    [TRENDS_INTERVAL, DEVICES_INTERVAL],
  );
  const socket = sockets.sockets[0];
  socket.receive({ type: 'realtime_update', payload: realtime() });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(gladys.fake.lastState(feature('power')), 2500);
  assert.equal(gladys.fake.lastState(feature('production_power')), 1801);
  assert.equal(gladys.fake.lastState(feature('voltage_l1')), 121.3);
  assert.equal(gladys.fake.lastState(feature('frequency')), 59.99);
  const fridge = `ext:sense:appliance:${MONITOR_ID}_fridge1`;
  const plug = `ext:sense:appliance:${MONITOR_ID}_plug-new`;
  assert.equal(gladys.fake.lastState(`${fridge}:on`), 1);
  assert.equal(gladys.fake.lastState(`${fridge}:power`), 144);
  assert.equal(gladys.fake.lastState(`${plug}:on`), 0, 'not in the update: off');
  assert.match(gladys.fake.connectionStatus.message.en, /Real time: connected/);
  // A second update within 10 s publishes nothing.
  const count = gladys.fake.states.length;
  clock.now += 2000;
  socket.receive({ type: 'realtime_update', payload: realtime({ w: 3000 }) });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(gladys.fake.states.length, count);
  // 10 s later: the monitor and the on/off, the appliance power waits a minute.
  clock.now += 10_000;
  socket.receive({
    type: 'realtime_update',
    payload: realtime({ w: 3000, devices: [{ id: 'fridge1', w: 0 }] }),
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(gladys.fake.lastState(feature('power')), 3000);
  assert.equal(gladys.fake.lastState(`${fridge}:on`), 0);
  assert.equal(gladys.fake.lastState(`${fridge}:power`), 144);
  clock.now += 60_000;
  socket.receive({
    type: 'realtime_update',
    payload: realtime({ devices: [{ id: 'fridge1', w: 0 }] }),
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(gladys.fake.lastState(`${fridge}:power`), 0);
  await app.stop();
});

test('the state budget holds the detected devices back, never the monitor', async () => {
  const { app, gladys } = setup({ config: { ...CONFIG, appliances: true } });
  await app.start({ ...CONFIG, appliances: true });
  app.budget = { start: NOW, count: 239 };
  await app.onRealtime(realtime());
  assert.equal(gladys.fake.lastState(feature('power')), 2500);
  assert.equal(gladys.fake.lastState(`ext:sense:appliance:${MONITOR_ID}_fridge1:on`), undefined);
  await app.stop();
});

test('two-factor: status, then the action completes the sign-in', async () => {
  let mfaAccepted = false;
  const { app, gladys, timers, sockets } = setup({
    routes: {
      authenticate: () => json(mfaChallenge, 401),
      mfa: ({ form }) => {
        mfaAccepted = form.totp === '654321' && form.mfa_token === 'mfa-tok';
        return mfaAccepted ? json(auth()) : json({ error_reason: 'bad code' }, 401);
      },
    },
  });
  await app.start(CONFIG);
  assert.equal(gladys.fake.connectionStatus.connected, false);
  assert.match(gladys.fake.connectionStatus.message.en, /two-factor code/);
  assert.equal(timers.pending.size, 0, 'only the user can go on');
  let ack = await gladys.fake.action(ACTIONS.MFA, { code: '12' });
  assert.match(ack.data.message.en, /6 digits/);
  ack = await gladys.fake.action(ACTIONS.MFA, { code: '111111' });
  assert.match(ack.data.message.en, /refused this code/);
  ack = await gladys.fake.action(ACTIONS.MFA, { code: '654 321' });
  assert.match(ack.data.message.en, /Code accepted/);
  assert.equal(mfaAccepted, true);
  assert.equal(fake.named('authenticate').length, 2, 'a fresh sign-in after the refused code');
  assert.equal(gladys.fake.connectionStatus.connected, true);
  assert.equal(sockets.sockets.length, 1);
  assert.equal(storedSession(gladys).access_token, 'acc-1');
  ack = await gladys.fake.action(ACTIONS.MFA, { code: '654321' });
  assert.match(ack.data.message.en, /No two-factor code is needed/);
  await app.stop();
});

test('refused password: told, retried only after 6 hours', async () => {
  const { app, gladys, timers } = setup({
    routes: { authenticate: () => json({ error_reason: 'Incorrect password' }, 401) },
  });
  await app.start(CONFIG);
  assert.match(gladys.fake.connectionStatus.message.fr, /refusé l’e-mail ou le mot de passe/);
  assert.deepEqual(
    timers.timeouts().map((t) => t.ms),
    [BAD_CREDENTIALS_RETRY],
  );
  assert.ok(!JSON.stringify(gladys.fake.connectionStatus).includes('pw'));
  await timers.runTimeouts();
  assert.equal(fake.named('authenticate').length, 2);
  await app.stop();
});

test('Sense unreachable at start: retried after 5, 15, then 60 minutes', async () => {
  const { app, gladys, timers } = setup({ routes: { authenticate: () => json({}, 503) } });
  await app.start(CONFIG);
  assert.match(gladys.fake.connectionStatus.message.en, /new try in 5 min/);
  const delays = [];
  for (let i = 0; i < 3; i += 1) {
    delays.push(timers.timeouts()[0].ms);
    await timers.runTimeouts();
  }
  assert.deepEqual(delays, LOGIN_RETRY);
  assert.equal(timers.timeouts()[0].ms, LOGIN_RETRY.at(-1));
  await app.stop();
});

test('a 429 at start waits for its Retry-After', async () => {
  const { app, gladys, timers } = setup({
    routes: { authenticate: () => json({}, 429, { 'retry-after': '600' }) },
  });
  await app.start(CONFIG);
  assert.match(gladys.fake.connectionStatus.message.en, /paused for 10 min/);
  assert.equal(timers.timeouts()[0].ms, 600_000);
  await app.stop();
});

test('an expired token while running: renewed once, the trends go on', async () => {
  let expired = false;
  const { app, gladys, timers, clock } = setup({
    routes: {
      usage: ({ headers, query }) =>
        expired && headers.Authorization === 'bearer acc-1'
          ? json({}, 401)
          : json(
              Date.parse(query.start) < Date.parse(TODAY_START) ? yesterdayUsage() : todayUsage(),
            ),
    },
  });
  await app.start(CONFIG);
  expired = true;
  clock.now += TRENDS_INTERVAL;
  await timers.runIntervals(TRENDS_INTERVAL);
  assert.equal(fake.named('renew').length, 1);
  assert.equal(storedSession(gladys).access_token, 'acc-2');
  assert.equal(gladys.fake.connectionStatus.connected, true);
  await app.stop();
});

test('a dead session while running: sign-in again, MFA stops everything cleanly', async () => {
  const { app, gladys, timers, sockets, clock } = setup();
  await app.start(CONFIG);
  clock.now += TRENDS_INTERVAL;
  fake.restore();
  fake = installFetch({
    usage: () => json({}, 401),
    renew: () => json({}, 401),
    authenticate: () => json(mfaChallenge, 401),
  });
  await timers.runIntervals(TRENDS_INTERVAL);
  await new Promise((resolve) => setImmediate(resolve));
  assert.match(gladys.fake.connectionStatus.message.en, /two-factor code/);
  assert.equal(timers.pending.size, 0);
  assert.equal(sockets.sockets[0].closed, true);
  assert.equal(fake.named('authenticate').length, 1, 'no loop');
});

test('the feed suspects the token: the app renews it before the reconnection', async () => {
  const { app, timers, sockets, clock } = setup();
  await app.start(CONFIG);
  clock.now += 6 * 60_000;
  sockets.sockets[0].receive({ type: 'error', payload: { authorized: false } });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(fake.named('renew').length, 1);
  await timers.runTimeouts((t) => t.ms !== LIVE_SILENCE);
  assert.match(sockets.sockets[1].url, /access_token=acc-2$/);
  await app.stop();
});

test('saving the same settings does not restart; other settings do', async () => {
  const { app, gladys } = setup();
  await app.start(CONFIG);
  const calls = fake.calls.length;
  await app.configUpdated({ ...CONFIG, [SESSION_KEY]: gladys.fake.config[SESSION_KEY] });
  assert.equal(fake.calls.length, calls);
  await app.configUpdated({ ...CONFIG, appliances: true });
  assert.equal(fake.named('devices').length, 1);
  assert.equal(fake.named('authenticate').length, 1, 'the session is kept');
  await app.stop();
});

test('test button and scan', async () => {
  const { app, gladys } = setup();
  let ack = await gladys.fake.action(ACTIONS.TEST);
  assert.match(ack.data.message.en, /e-mail and password/);
  await app.start(CONFIG);
  ack = await gladys.fake.action(ACTIONS.TEST);
  assert.match(ack.data.message.en, /Connected to Sense N123A456 \(solar\)/);
  await gladys.fake.scanRequest();
  assert.equal(gladys.fake.discoveredDevices.length, 1);
  await app.stop();
});
