// -----------------------------------------------------------------------------
// The Sense account client against a fake Sense API: sign-in, two-factor
// code, renewal without loops, 429 pause, secrets kept out of the errors.
// -----------------------------------------------------------------------------

import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { SenseError, request, retryAfterMs } from '../src/http.js';
import { SenseClient } from '../src/sense/api.js';
import { installFetch, json } from './helpers/fakeFetch.js';
import { MONITOR_ID, NOW, auth, mfaChallenge, overview } from './fixtures/sense.js';

let fake;
afterEach(() => fake?.restore());

const clock = { now: NOW };
const client = (options = {}) =>
  new SenseClient({
    email: 'me@example.com',
    password: 'pw',
    now: () => clock.now,
    ...options,
  });

test('sign-in: form-encoded e-mail and password, the client id header, the first monitor', async () => {
  fake = installFetch({ authenticate: () => json(auth()) });
  const sessions = [];
  const c = client({ onSession: (s) => sessions.push(s) });
  await c.login();
  const [call] = fake.calls;
  assert.equal(call.method, 'POST');
  assert.equal(call.headers['Content-Type'], 'application/x-www-form-urlencoded');
  assert.deepEqual(call.form, { email: 'me@example.com', password: 'pw' });
  assert.match(call.headers['x-sense-device-id'], /^[0-9a-f]{32}$/);
  assert.match(call.headers['User-Agent'], /^gladys-sense\//);
  assert.equal(c.monitorId, MONITOR_ID);
  assert.equal(c.signedIn, true);
  assert.deepEqual(sessions.at(-1), {
    email: 'me@example.com',
    device_id: call.headers['x-sense-device-id'],
    user_id: '4242',
    monitor_id: MONITOR_ID,
    access_token: 'acc-1',
    refresh_token: 'ref-1',
  });
});

test('refused credentials and no monitor are told apart', async () => {
  fake = installFetch({
    authenticate: () => json({ status: 'error', error_reason: 'Incorrect password' }, 401),
  });
  await assert.rejects(client().login(), (err) => {
    assert.equal(err.code, 'bad_credentials');
    assert.match(err.message, /Incorrect password/);
    assert.ok(!err.message.includes('me@example.com'));
    return true;
  });
  fake.restore();
  fake = installFetch({ authenticate: () => json(auth({ monitors: [] })) });
  await assert.rejects(client().login(), { code: 'no_monitor' });
  await assert.rejects(client({ password: '' }).login(), { code: 'no_credentials' });
});

test('two-factor: the mfa token is kept, the code completes the sign-in', async () => {
  let codeOk = false;
  fake = installFetch({
    authenticate: () => json(mfaChallenge, 401),
    mfa: ({ form }) =>
      form.totp === '123456' && codeOk ? json(auth()) : json({ error_reason: 'Bad code' }, 401),
  });
  const c = client();
  await assert.rejects(c.login(), { code: 'mfa_required' });
  assert.equal(c.mfaToken, 'mfa-tok');
  await assert.rejects(c.verifyMfa('000000'), { code: 'bad_mfa' });
  assert.equal(c.mfaToken, '', 'a refused code needs a fresh sign-in');
  await assert.rejects(c.verifyMfa('123456'), { code: 'mfa_expired' });
  await assert.rejects(c.login(), { code: 'mfa_required' });
  codeOk = true;
  await c.verifyMfa('123456');
  const mfa = fake.named('mfa').at(-1);
  assert.equal(mfa.form.mfa_token, 'mfa-tok');
  assert.equal(mfa.form.client_time, new Date(NOW).toISOString().replace('.000Z', 'Z'));
  assert.match(mfa.form.client_time, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);
  assert.equal(c.signedIn, true);
  assert.equal(c.mfaToken, '');
});

test('a 401 renews the token once and retries once', async () => {
  let token = 'acc-old';
  fake = installFetch({
    renew: ({ form }) => {
      assert.deepEqual(form, { user_id: '4242', refresh_token: 'ref-1' });
      token = 'acc-2';
      return json({ access_token: 'acc-2', refresh_token: 'ref-2', user_id: 4242 });
    },
    overview: ({ headers }) =>
      headers.Authorization === `bearer ${token}` && token === 'acc-2'
        ? json(overview())
        : json({}, 401),
  });
  const c = client({
    session: {
      email: 'me@example.com',
      device_id: 'dev',
      user_id: '4242',
      monitor_id: MONITOR_ID,
      access_token: 'acc-old',
      refresh_token: 'ref-1',
    },
  });
  assert.equal((await c.monitorOverview()).monitor_overview.monitor.serial_number, 'N123A456');
  assert.deepEqual(
    fake.calls.map((x) => x.name),
    ['overview', 'renew', 'overview'],
  );
  assert.equal(fake.calls[0].headers['x-sense-device-id'], 'dev', 'the stored client id');
  assert.equal(c.refreshToken, 'ref-2');
  // Refused again right away: no second renewal (no loop).
  token = 'never';
  await assert.rejects(c.monitorOverview(), { code: 'unauthorized' });
  assert.equal(fake.named('renew').length, 1);
});

test('a refused renewal falls back to ONE sign-in with the password', async () => {
  fake = installFetch({
    renew: () => json({ error_reason: 'invalid refresh token' }, 401),
    authenticate: () => json(mfaChallenge, 401),
  });
  const sessions = [];
  const c = client({
    session: { email: 'me@example.com', user_id: '1', refresh_token: 'r', monitor_id: 'm' },
    onSession: (s) => sessions.push(s),
  });
  await assert.rejects(c.refresh(), { code: 'mfa_required' });
  assert.deepEqual(sessions, [], 'the session is replaced only by a successful sign-in');
  assert.deepEqual(
    fake.calls.map((x) => x.name),
    ['renew', 'authenticate'],
  );
  // A passing error of the renewal is not a refusal: no password sign-in.
  for (const [answer, code] of [
    [() => json({}, 503), 'http'],
    [() => new Response('<html>blocked</html>', { status: 403 }), 'blocked'],
    [() => json({}, 400), 'http'],
    [() => json({}, 404), 'not_found'],
  ]) {
    fake.restore();
    fake = installFetch({ renew: answer });
    const d = client({ session: { user_id: '1', refresh_token: 'r', monitor_id: 'm' } });
    await assert.rejects(d.refresh(), { code });
    assert.equal(d.refreshToken, 'r');
    assert.deepEqual(
      fake.calls.map((x) => x.name),
      ['renew'],
    );
  }
});

test('concurrent renewals share one call', async () => {
  fake = installFetch({ renew: () => json({ access_token: 'n', refresh_token: 'r2' }) });
  const c = client({ session: { user_id: '1', refresh_token: 'r', monitor_id: 'm' } });
  await Promise.all([c.refresh(), c.refresh(), c.refresh()]);
  assert.equal(fake.named('renew').length, 1);
});

test('a 429 pauses every call for its Retry-After', async () => {
  fake = installFetch({ overview: () => json({}, 429, { 'retry-after': '120' }) });
  const c = client({
    session: { user_id: '1', refresh_token: 'r', monitor_id: 'm', access_token: 'a' },
  });
  await assert.rejects(
    c.monitorOverview(),
    (err) => err.code === 'rate_limited' && err.retryAfter === 120_000,
  );
  await assert.rejects(c.monitorOverview(), { code: 'rate_limited' });
  assert.equal(fake.calls.length, 1, 'no call during the pause');
  clock.now += 121_000;
  await assert.rejects(c.monitorOverview(), { code: 'rate_limited' });
  assert.equal(fake.calls.length, 2);
  clock.now = NOW;
});

test('the 429 pause stays between 1 minute and 6 hours', async () => {
  for (const [header, pause] of [
    ['0', 60_000],
    [new Date(NOW - 3_600_000).toUTCString(), 60_000],
    ['1000000000', 6 * 3_600_000],
    [undefined, 15 * 60_000],
  ]) {
    fake?.restore();
    fake = installFetch({
      overview: () => json({}, 429, header === undefined ? {} : { 'retry-after': header }),
    });
    const c = client({
      session: { user_id: '1', refresh_token: 'r', monitor_id: 'm', access_token: 'a' },
    });
    await assert.rejects(c.monitorOverview(), (err) => err.retryAfter === pause);
    assert.equal(c.pausedUntil, NOW + pause, String(header));
  }
});

test('a 403 refuses only with Sense JSON error', async () => {
  fake = installFetch({
    overview: () => new Response('<html>Forbidden</html>', { status: 403 }),
    devices: () => json({ status: 'error', error_reason: 'Not allowed' }, 403),
    renew: () => json({ access_token: 'n' }),
  });
  const c = client({
    session: { user_id: '1', refresh_token: 'r', monitor_id: 'm', access_token: 'a' },
  });
  await assert.rejects(c.monitorOverview(), { code: 'blocked' });
  assert.equal(fake.named('renew').length, 0, 'a passing 403 renews nothing');
  await assert.rejects(c.devicesOverview(), { code: 'unauthorized' });
  assert.equal(fake.named('renew').length, 1);
});

test('any 4xx of the code step forgets the mfa token', async () => {
  fake = installFetch({
    authenticate: () => json(mfaChallenge, 401),
    mfa: () => json({}, 400),
  });
  const c = client();
  await assert.rejects(c.login(), { code: 'mfa_required' });
  await assert.rejects(c.verifyMfa('123456'), { code: 'http' });
  assert.equal(c.mfaToken, '');
});

test('HTTP errors never carry the URL, the body or the credentials', async () => {
  fake = installFetch({
    usage: () => {
      throw new TypeError('fetch failed https://api.sense.com/...?access_token=x');
    },
    overview: () => new Response('<html>oops</html>', { status: 200 }),
    devices: () => json({}, 500),
  });
  const c = client({
    session: { user_id: '1', refresh_token: 'r', monitor_id: 'm', access_token: 'a' },
  });
  await assert.rejects(c.usage('2026-10-16T00:00:00'), (err) => {
    assert.equal(err.code, 'network');
    assert.equal(err.message, 'network error');
    return true;
  });
  await assert.rejects(c.monitorOverview(), { code: 'http', message: /not JSON/ });
  await assert.rejects(c.devicesOverview(), { code: 'http', message: 'Sense answered 500' });
  assert.ok(new SenseError('x', 'y') instanceof Error);
});

test('the trends are asked for a DAY from a UTC start', async () => {
  fake = installFetch({ usage: () => json({}) });
  const c = client({
    session: { user_id: '1', refresh_token: 'r', monitor_id: MONITOR_ID, access_token: 'a' },
  });
  await c.usage('2026-10-16T18:20:00');
  assert.match(fake.calls[0].path, new RegExp(`/app/monitors/${MONITOR_ID}/history/usage$`));
  assert.deepEqual(fake.calls[0].query, { scale: 'DAY', start: '2026-10-16T18:20:00' });
  assert.equal(fake.calls[0].headers.Authorization, 'bearer a');
});

test('Retry-After in seconds or as a date', () => {
  assert.equal(retryAfterMs('30'), 30_000);
  assert.equal(retryAfterMs(new Date(NOW + 5000).toUTCString(), NOW), 5000);
  assert.equal(retryAfterMs('soon'), undefined);
  assert.equal(retryAfterMs(undefined), undefined);
  assert.equal(typeof request, 'function');
});
