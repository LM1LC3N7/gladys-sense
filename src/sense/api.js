// -----------------------------------------------------------------------------
// The Sense account: sign-in (e-mail + password, two-factor code when the
// account asks for one), renewal of the access token, and the authenticated
// GETs. Ported from sense-energy (scottbonline/sense, MIT): the endpoints,
// the form-encoded sign-in, the `mfa_token` answer, the `renew` call with the
// refresh token, and "renew once, then retry once" on a 401.
//
// Safety rules (no loop, no burst):
// - a token is renewed at most once every RENEW_MIN_GAP, concurrent callers
//   share the same renewal;
// - a refused renewal falls back to ONE sign-in with the password; a refused
//   password is reported, never retried here;
// - a 429 pauses EVERY call of the client until its Retry-After has passed.
// -----------------------------------------------------------------------------

import { randomUUID } from 'node:crypto';
import { RATE_LIMIT_MAX, RATE_LIMIT_MIN, RATE_LIMIT_PAUSE, RENEW_MIN_GAP } from '../constants.js';
import { SenseError, request } from '../http.js';

/** A new client id, as sense-energy makes it (uuid4 without dashes). */
export const newDeviceId = () => randomUUID().replace(/-/g, '');

export class SenseClient {
  constructor({
    email = '',
    password = '',
    session,
    now = Date.now,
    onSession = () => {},
    send = request,
  } = {}) {
    this.email = email;
    this.password = password;
    this.now = now;
    this.onSession = onSession;
    this.send = send;
    this.deviceId = session?.device_id || newDeviceId();
    this.accessToken = session?.access_token ?? '';
    this.refreshToken = session?.refresh_token ?? '';
    this.userId = session?.user_id ?? '';
    this.monitorId = session?.monitor_id ?? '';
    this.mfaToken = '';
    this.lastRenewAt = -Infinity;
    this.renewing = undefined;
    this.pausedUntil = 0;
  }

  get signedIn() {
    return Boolean(this.accessToken && this.monitorId);
  }

  /** What is stored (outside the config schema) to survive a restart. */
  session() {
    return {
      email: this.email,
      device_id: this.deviceId,
      user_id: this.userId,
      monitor_id: this.monitorId,
      access_token: this.accessToken,
      refresh_token: this.refreshToken,
    };
  }

  // --- Low level -----------------------------------------------------------------

  async call(path, options = {}) {
    if (this.now() < this.pausedUntil) {
      throw new SenseError('rate_limited', 'Sense asked to slow down (429)', 429);
    }
    try {
      return await this.send(path, { deviceId: this.deviceId, ...options });
    } catch (err) {
      if (err instanceof SenseError && err.code === 'rate_limited') {
        // Bounded: a Retry-After of 0 or in the past would retry at once,
        // a huge one would silence the integration for good.
        const pause = Math.min(
          RATE_LIMIT_MAX,
          Math.max(RATE_LIMIT_MIN, err.retryAfter ?? RATE_LIMIT_PAUSE),
        );
        this.pausedUntil = this.now() + pause;
        err.retryAfter = pause;
      }
      throw err;
    }
  }

  setAuth(data, { withMonitor = false } = {}) {
    if (typeof data?.access_token !== 'string' || !data.access_token) {
      throw new SenseError('http', 'Sense answered without an access token');
    }
    this.accessToken = data.access_token;
    if (typeof data.refresh_token === 'string' && data.refresh_token) {
      this.refreshToken = data.refresh_token;
    }
    if (data.user_id !== undefined && data.user_id !== null) {
      this.userId = String(data.user_id);
    }
    if (withMonitor) {
      const monitor = Array.isArray(data.monitors) ? data.monitors[0] : undefined;
      if (!monitor || monitor.id === undefined || monitor.id === null) {
        throw new SenseError('no_monitor', 'This Sense account has no monitor');
      }
      this.monitorId = String(monitor.id);
    }
    this.onSession(this.session());
    return data;
  }

  // --- Sign-in ---------------------------------------------------------------------

  /** Sign in with the password. Throws mfa_required (keeps the mfa token) or bad_credentials. */
  async login() {
    if (!this.email || !this.password) {
      throw new SenseError('no_credentials', 'No Sense e-mail or password configured');
    }
    let data;
    try {
      data = await this.call('authenticate', {
        form: { email: this.email, password: this.password },
      });
    } catch (err) {
      if (err instanceof SenseError && err.code === 'mfa_required') {
        this.mfaToken = err.mfaToken;
        throw err;
      }
      if (err instanceof SenseError && err.code === 'unauthorized') {
        throw new SenseError('bad_credentials', err.message, err.status);
      }
      throw err;
    }
    this.mfaToken = '';
    this.lastRenewAt = this.now();
    return this.setAuth(data, { withMonitor: true });
  }

  /** Complete a sign-in with the 6-digit code of the authenticator app. */
  async verifyMfa(code) {
    if (!this.mfaToken) {
      throw new SenseError('mfa_expired', 'No two-factor sign-in in progress');
    }
    let data;
    try {
      data = await this.call('authenticate/mfa', {
        form: {
          totp: code,
          mfa_token: this.mfaToken,
          client_time: new Date(this.now()).toISOString().replace(/\.\d{3}Z$/, 'Z'),
        },
      });
    } catch (err) {
      // A refused or stale code, or any other 4xx: the next try signs in
      // again for a fresh mfa token.
      if (err instanceof SenseError && err.status >= 400 && err.status < 500) {
        this.mfaToken = '';
      }
      if (err instanceof SenseError && err.code === 'unauthorized') {
        throw new SenseError('bad_mfa', err.message, err.status);
      }
      throw err;
    }
    this.mfaToken = '';
    this.lastRenewAt = this.now();
    return this.setAuth(data, { withMonitor: true });
  }

  /**
   * A fresh access token: `renew` with the refresh token, else ONE sign-in
   * with the password. Rate-limited to one attempt per RENEW_MIN_GAP;
   * concurrent callers share it.
   */
  refresh() {
    if (this.renewing) {
      return this.renewing;
    }
    if (this.now() - this.lastRenewAt < RENEW_MIN_GAP) {
      return Promise.reject(
        new SenseError('unauthorized', 'Sense refused the token again shortly after a renewal'),
      );
    }
    this.lastRenewAt = this.now();
    this.renewing = this.doRefresh().finally(() => {
      this.renewing = undefined;
    });
    return this.renewing;
  }

  async doRefresh() {
    if (this.refreshToken && this.userId) {
      try {
        const data = await this.call('renew', {
          form: { user_id: this.userId, refresh_token: this.refreshToken },
        });
        return this.setAuth(data);
      } catch (err) {
        // Only a real refusal of the renewal (401, or 403 with Sense's error)
        // falls back to the password; anything else stays what it is.
        if (!(err instanceof SenseError) || err.code !== 'unauthorized') {
          throw err;
        }
      }
    }
    // The stored session is replaced only once the sign-in succeeded (setAuth).
    return this.login();
  }

  // --- Authenticated reads -------------------------------------------------------------

  /** GET with the access token; a 401 renews the token once and retries once. */
  async get(path) {
    if (!this.accessToken) {
      await this.refresh();
    }
    try {
      return await this.call(path, { token: this.accessToken });
    } catch (err) {
      if (!(err instanceof SenseError) || err.code !== 'unauthorized') {
        throw err;
      }
    }
    await this.refresh();
    return this.call(path, { token: this.accessToken });
  }

  monitorOverview() {
    return this.get(`app/monitors/${encodeURIComponent(this.monitorId)}/overview`);
  }

  devicesOverview() {
    return this.get(`app/monitors/${encodeURIComponent(this.monitorId)}/devices/overview`);
  }

  /** The DAY trend containing `start` (a `YYYY-MM-DDTHH:MM:SS` UTC string). */
  usage(start) {
    return this.get(
      `app/monitors/${encodeURIComponent(this.monitorId)}/history/usage?scale=DAY&start=${encodeURIComponent(start)}`,
    );
  }
}
