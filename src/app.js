// -----------------------------------------------------------------------------
// The integration itself: the Sense session (sign-in, two-factor code,
// renewal, kept across restarts), the monitor device and the devices Sense
// detected, the real-time feed (throttled), and the 30-minute consumption fed
// to the Gladys energy monitoring. index.js only wires the SDK handlers to it.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { normalizeConfig, sameSettings } from './config.js';
import {
  APPLIANCE_POWER_THROTTLE,
  BAD_CREDENTIALS_RETRY,
  DEVICES_INTERVAL,
  LIVE_RENEW_BACKOFF,
  LIVE_THROTTLE,
  LOGIN_RETRY,
  RATE_LIMIT_PAUSE,
  SESSION_KEY,
  STATES_PER_MINUTE,
  TRENDS_INTERVAL,
  YESTERDAY_REREAD,
} from './constants.js';
import {
  FEATURE,
  applianceStates,
  buildApplianceDevice,
  buildMonitorDevice,
  ids,
  liveStates,
} from './devices.js';
import { SenseError } from './http.js';
import { T } from './i18n.js';
import { SenseClient } from './sense/api.js';
import { RealtimeFeed } from './sense/live.js';
import { appliancesOf, halfHoursOf, liveOf, monitorOf, trendStart } from './sense/model.js';

const defaultTimers = { setTimeout, clearTimeout, setInterval, clearInterval };

/** Errors only the user can solve: the integration stops and says so. */
const FATAL = new Set(['no_credentials', 'bad_credentials', 'mfa_required', 'no_monitor']);
const isFatal = (err) => err instanceof SenseError && FATAL.has(err.code);
const minutes = (ms) => Math.max(1, Math.round(ms / 60_000));
/** The test button answers within this delay, with the known status otherwise. */
const TEST_ANSWER_WITHIN = 10_000;

export class SenseApp {
  constructor({
    gladys,
    logger = createLogger({ name: 'sense' }),
    now = Date.now,
    timers = defaultTimers,
    random = Math.random,
    clientFactory = (options) => new SenseClient(options),
    feedFactory = (options) => new RealtimeFeed(options),
  }) {
    this.gladys = gladys;
    this.logger = logger;
    this.now = now;
    this.timers = timers;
    this.random = random;
    this.clientFactory = clientFactory;
    this.feedFactory = feedFactory;
    this.raw = {};
    this.config = normalizeConfig();
    this.client = undefined;
    this.session = undefined;
    this.savedSession = undefined;
    this.sessionWrite = Promise.resolve();
    this.monitor = undefined;
    this.appliances = [];
    this.powers = new Map();
    this.usage = { today: undefined, yesterday: undefined };
    this.yesterdayFor = undefined;
    this.consumptionWarned = false;
    this.live = undefined;
    this.liveConnected = false;
    this.liveRenew = { attempts: 0, notBefore: -Infinity };
    this.lastLive = undefined;
    this.lastMainAt = -Infinity;
    this.lastApplianceAt = -Infinity;
    this.budget = { start: -Infinity, count: 0 };
    this.timerIds = [];
    this.retryTimer = undefined;
    this.retryIndex = 0;
    this.running = false;
    this.lastStatus = undefined;
    this.lastMessage = undefined;
    this.generation = 0;
    this.lifecycle = Promise.resolve();
  }

  // --- Lifecycle -------------------------------------------------------------

  start(raw = {}) {
    return this.serialize(() => this.doStart(raw));
  }

  stop() {
    return this.serialize(() => this.doStop());
  }

  /** Resolves once every queued start/stop is done (tests, shutdown). */
  idle() {
    return this.lifecycle;
  }

  /** The user saved the form: restart, unless nothing that matters changed. */
  configUpdated(raw = {}) {
    const next = normalizeConfig(raw);
    if (this.running && sameSettings(next, this.config)) {
      this.raw = raw;
      return Promise.resolve();
    }
    return this.start(raw);
  }

  serialize(job) {
    const run = this.lifecycle.then(job, job);
    this.lifecycle = run.catch(() => {});
    return run;
  }

  /** Run a periodic job; its errors are ignored once the integration restarted or stopped. */
  task(job) {
    const generation = this.generation;
    return job().catch((err) =>
      generation === this.generation ? this.runningError(err) : undefined,
    );
  }

  async doStart(raw) {
    await this.doStop();
    const generation = ++this.generation;
    this.raw = raw;
    this.config = normalizeConfig(raw);
    this.liveRenew = { attempts: 0, notBefore: -Infinity };
    if (this.savedSession === undefined && typeof raw[SESSION_KEY] === 'string') {
      this.savedSession = raw[SESSION_KEY];
    }
    if (!this.config.email || !this.config.password) {
      await this.setStatus(false, T.noCredentials);
      return;
    }
    // The freshest session of this e-mail: the one in memory, else the stored one.
    const session = [this.session, this.config.session].find(
      (s) => s && s.email === this.config.email,
    );
    this.client = this.clientFactory({
      email: this.config.email,
      password: this.config.password,
      session,
      now: this.now,
      onSession: (s) => this.saveSession(s),
    });
    try {
      await this.connect(generation);
      this.retryIndex = 0;
    } catch (err) {
      if (generation !== this.generation) {
        return;
      }
      await this.doStop();
      await this.handleFailure(err, this.generation);
    }
  }

  async connect(generation) {
    if (!this.client.signedIn) {
      await this.client.login();
    }
    const overview = await this.client.monitorOverview();
    if (generation !== this.generation) {
      return;
    }
    this.monitor = monitorOf(overview, { id: this.client.monitorId });
    if (!this.monitor.id) {
      this.monitor.id = this.client.monitorId;
    }
    await this.discover();
    if (generation !== this.generation) {
      return;
    }
    this.running = true;
    this.timerIds.push(
      this.timers.setInterval(() => this.task(() => this.refreshTrends()), TRENDS_INTERVAL),
    );
    if (this.config.appliances) {
      this.timerIds.push(
        this.timers.setInterval(() => this.task(() => this.discover()), DEVICES_INTERVAL),
      );
    }
    // The real time does not wait for the trends: a failed trend read only
    // delays the energy monitoring.
    this.startLive();
    await this.reportOk();
    try {
      await this.refreshTrends();
    } catch (err) {
      if (isFatal(err)) {
        throw err;
      }
      await this.runningError(err);
    }
  }

  async doStop() {
    this.generation += 1;
    this.running = false;
    for (const id of this.timerIds) {
      this.timers.clearInterval(id);
    }
    this.timerIds = [];
    this.timers.clearTimeout(this.retryTimer);
    this.retryTimer = undefined;
    this.live?.stop();
    this.live = undefined;
    this.liveConnected = false;
  }

  /** A failure at start (or a fatal one later): say why, retry when it makes sense. */
  async handleFailure(err, generation) {
    if (generation !== this.generation) {
      return;
    }
    this.logger.warn(`Sense: ${err.message}`);
    const code = err instanceof SenseError ? err.code : 'unknown';
    if (code === 'no_credentials') {
      await this.setStatus(false, T.noCredentials);
    } else if (code === 'mfa_required') {
      // Only the user can go further, with the "verify_mfa" action.
      await this.setStatus(false, T.mfaRequired);
    } else if (code === 'bad_credentials') {
      await this.setStatus(false, T.badCredentials(BAD_CREDENTIALS_RETRY / 3_600_000));
      this.scheduleRetry(BAD_CREDENTIALS_RETRY);
    } else if (code === 'no_monitor') {
      await this.setStatus(false, T.noMonitor);
      this.scheduleRetry(BAD_CREDENTIALS_RETRY);
    } else if (code === 'rate_limited') {
      const delay = err.retryAfter ?? RATE_LIMIT_PAUSE;
      await this.setStatus(false, T.rateLimited(minutes(delay)));
      this.scheduleRetry(delay);
    } else {
      const delay = LOGIN_RETRY[Math.min(this.retryIndex, LOGIN_RETRY.length - 1)];
      this.retryIndex += 1;
      await this.setStatus(false, T.retry(minutes(delay), err.message));
      this.scheduleRetry(delay);
    }
  }

  scheduleRetry(delay) {
    this.timers.clearTimeout(this.retryTimer);
    this.retryTimer = this.timers.setTimeout(() => {
      this.retryTimer = undefined;
      return this.start(this.raw).catch((err) => this.logger.warn(`Sense retry: ${err.message}`));
    }, delay);
  }

  /** An error of a periodic job while running. */
  async runningError(err) {
    if (isFatal(err)) {
      return this.serialize(async () => {
        await this.doStop();
        await this.handleFailure(err, this.generation);
      });
    }
    this.logger.warn(`Sense: ${err.message}`);
    if (err instanceof SenseError && err.code === 'rate_limited') {
      // The client refuses every call until the pause is over.
      await this.setStatus(false, T.rateLimited(minutes(err.retryAfter ?? RATE_LIMIT_PAUSE)));
      return undefined;
    }
    await this.setStatus(false, T.unreachable(err.message));
    return undefined;
  }

  async setStatus(connected, message) {
    this.lastMessage = message;
    const key = JSON.stringify([connected, message ?? null]);
    if (key === this.lastStatus) {
      return;
    }
    this.lastStatus = key;
    await this.gladys
      .setConnectionStatus(connected, message)
      .catch((err) => this.logger.warn(`setConnectionStatus failed: ${err.message}`));
  }

  monitorName() {
    return `Sense ${this.monitor?.serial || this.monitor?.id || ''}`.trim();
  }

  async reportOk() {
    if (this.running) {
      await this.setStatus(true, T.ok(this.monitorName(), this.liveConnected));
    }
  }

  /**
   * Keep the session (tokens, client id) outside the config schema, written
   * only when it changed, one write after the other (the last one wins); a
   * failed write is tried again with the next change.
   */
  saveSession(session) {
    this.session = session;
    const json = JSON.stringify(session);
    if (json === this.savedSession) {
      return;
    }
    this.savedSession = json;
    this.sessionWrite = this.sessionWrite
      .then(() => this.gladys.setConfig({ [SESSION_KEY]: json }))
      .catch((err) => {
        this.logger.warn(`Saving the Sense session failed: ${err.message}`);
        if (this.savedSession === json) {
          this.savedSession = undefined;
        }
      });
  }

  // --- Devices ---------------------------------------------------------------------

  async discover() {
    if (!this.monitor) {
      return;
    }
    if (this.config.appliances) {
      try {
        this.appliances = appliancesOf(await this.client.devicesOverview());
      } catch (err) {
        if (isFatal(err)) {
          throw err;
        }
        this.logger.warn(`Sense devices unavailable: ${err.message}`);
      }
    } else {
      this.appliances = [];
    }
    await this.gladys.publishDiscoveredDevices([
      buildMonitorDevice(this.gladys, this.monitor),
      ...this.appliances.map((a) => buildApplianceDevice(this.gladys, this.monitor, a)),
    ]);
  }

  /** The user asked for a scan: never throws at the SDK. */
  scan() {
    return this.task(() => this.discover());
  }

  /** The monitor device was just created: its consumption can be published now. */
  async deviceCreated(device) {
    if (this.monitor && device?.external_id === ids.monitor(this.gladys, this.monitor.id).device) {
      await this.publishConsumption();
    }
  }

  // --- Energy monitoring ---------------------------------------------------------------

  async refreshTrends() {
    if (!this.monitor) {
      return;
    }
    const now = this.now();
    const today = await this.client.usage(trendStart(now));
    this.usage.today = today;
    // Yesterday once per day, and again at every refresh during the first
    // hours of the day: Sense completes its last hours late.
    const dayStart = Date.parse(today?.start ?? '');
    if (
      Number.isFinite(dayStart) &&
      (this.yesterdayFor !== today.start || now - dayStart < YESTERDAY_REREAD)
    ) {
      try {
        this.usage.yesterday = await this.client.usage(trendStart(dayStart - 12 * 60 * 60_000));
        this.yesterdayFor = today.start;
      } catch (err) {
        if (isFatal(err)) {
          throw err;
        }
        this.logger.warn(`Yesterday's Sense trend unavailable: ${err.message}`);
      }
    }
    await this.publishConsumption();
    await this.reportOk();
  }

  /** The finished hours of yesterday and today, as dated 30-minute consumption. */
  async publishConsumption() {
    if (!this.monitor) {
      return;
    }
    const now = this.now();
    const byStart = new Map();
    for (const usage of [this.usage.yesterday, this.usage.today]) {
      for (const interval of halfHoursOf(usage, now)) {
        byStart.set(interval.starts_at, interval);
      }
    }
    if (byStart.size === 0) {
      return;
    }
    try {
      await this.gladys.publishEnergyConsumption(
        ids.monitor(this.gladys, this.monitor.id).feature(FEATURE.CONSUMPTION),
        [...byStart.values()],
      );
      this.consumptionWarned = false;
    } catch (err) {
      if (err?.status === 404) {
        // The device is not created yet: published again at its creation.
        this.logger.debug?.(`Sense consumption not published yet: ${err.message}`);
      } else if (!this.consumptionWarned) {
        this.consumptionWarned = true;
        this.logger.warn(`Sense consumption refused by Gladys: ${err.message}`);
      }
    }
  }

  // --- Real time -----------------------------------------------------------------------

  startLive() {
    this.live = this.feedFactory({
      monitorId: this.monitor.id,
      getToken: () => this.client?.accessToken,
      onUpdate: (payload) =>
        this.onRealtime(payload).catch((err) =>
          this.logger.warn(`Sense live states failed: ${err.message}`),
        ),
      onStatus: (connected) => {
        this.liveConnected = connected;
        this.reportOk().catch(() => {});
      },
      onAuthError: () => this.renewForLive(),
      logger: this.logger,
      timers: this.timers,
      random: this.random,
    });
    this.live.start();
  }

  /**
   * The feed suspects the token: renew it before it reconnects. These
   * renewals have their own backoff (5 min, doubling, up to 6 h), fully
   * reset (attempts and waiting time) by the next realtime update, on top of
   * the client's own limit of one renewal every 5 minutes.
   */
  async renewForLive() {
    const now = this.now();
    if (now < this.liveRenew.notBefore) {
      this.logger.debug?.('Sense: token renewal for the feed postponed (backoff)');
      return;
    }
    this.liveRenew.notBefore =
      now +
      Math.min(LIVE_RENEW_BACKOFF.max, LIVE_RENEW_BACKOFF.base * 2 ** this.liveRenew.attempts);
    this.liveRenew.attempts += 1;
    const generation = this.generation;
    try {
      await this.client.refresh();
    } catch (err) {
      if (generation !== this.generation) {
        return;
      }
      if (isFatal(err)) {
        await this.runningError(err);
        return;
      }
      this.logger.warn(`Sense token not renewed: ${err.message}`);
    }
  }

  /** A realtime update (about every second): throttled publication. */
  async onRealtime(payload) {
    const live = liveOf(payload);
    this.lastLive = live;
    // The feed works: its renewal backoff starts over.
    this.liveRenew = { attempts: 0, notBefore: -Infinity };
    if (live.devices) {
      this.powers = live.devices;
    }
    const now = this.now();
    if (!this.monitor || now - this.lastMainAt < LIVE_THROTTLE) {
      return;
    }
    this.lastMainAt = now;
    const withPower = now - this.lastApplianceAt >= APPLIANCE_POWER_THROTTLE;
    if (withPower) {
      this.lastApplianceAt = now;
    }
    await this.publish(liveStates(this.gladys, this.monitor, live), {
      heartbeat: 5 * 60_000,
      essential: true,
    });
    if (this.config.appliances && this.appliances.length > 0) {
      await this.publish(
        applianceStates(this.gladys, this.monitor, this.appliances, this.powers, { withPower }),
        { heartbeat: 30 * 60_000, essential: false },
      );
    }
  }

  /**
   * publishChangedStates under a budget: Gladys takes 300 states a minute;
   * past STATES_PER_MINUTE, the optional states (detected devices) wait.
   */
  async publish(states, { heartbeat, essential }) {
    if (states.length === 0) {
      return;
    }
    const now = this.now();
    if (now - this.budget.start >= 60_000) {
      this.budget = { start: now, count: 0 };
    }
    if (!essential && this.budget.count + states.length > STATES_PER_MINUTE) {
      this.logger.debug?.('Sense: state budget reached, detected devices wait');
      return;
    }
    try {
      const result = await this.gladys.publishChangedStates(states, { heartbeat });
      this.budget.count += result?.count ?? states.length;
    } catch (err) {
      this.logger.warn(`Sense states failed: ${err.message}`);
    }
  }

  // --- Configuration screen buttons ----------------------------------------------------

  messageOf(err) {
    const code = err instanceof SenseError ? err.code : 'unknown';
    if (code === 'no_credentials') return T.noCredentials;
    if (code === 'bad_credentials') return T.badCredentials(BAD_CREDENTIALS_RETRY / 3_600_000);
    if (code === 'mfa_required') return T.mfaRequired;
    if (code === 'no_monitor') return T.noMonitor;
    if (code === 'rate_limited') return T.rateLimited(minutes(err.retryAfter ?? RATE_LIMIT_PAUSE));
    return T.unreachable(err.message);
  }

  /** The test button: a fresh read of the monitor, or the known status after 10 s. */
  async testConnection() {
    if (!this.config.email || !this.config.password) {
      return T.noCredentials;
    }
    if (!this.running) {
      return this.lastMessage ?? T.noCredentials;
    }
    let timer;
    const late = new Promise((resolve) => {
      timer = this.timers.setTimeout(() => resolve(this.lastMessage), TEST_ANSWER_WITHIN);
    });
    const check = this.client.monitorOverview().then(
      (overview) =>
        T.test.ok(this.monitorName(), monitorOf(overview, this.monitor).solar, this.liveConnected),
      (err) => this.messageOf(err),
    );
    try {
      return await Promise.race([check, late]);
    } finally {
      this.timers.clearTimeout(timer);
    }
  }

  /**
   * The "verify_mfa" action: complete a sign-in with the authenticator code.
   * Answers as soon as Sense accepted the code; the integration then starts
   * in the background.
   */
  async verifyMfa(fields = {}) {
    const code = String(fields.code ?? '').replace(/\s+/g, '');
    if (!/^\d{6}$/.test(code)) {
      return T.mfa.badFormat;
    }
    if (this.running) {
      return T.mfa.notNeeded;
    }
    if (!this.client || !this.config.email || !this.config.password) {
      return T.noCredentials;
    }
    return this.serialize(async () => {
      try {
        if (!this.client.mfaToken) {
          try {
            await this.client.login();
          } catch (err) {
            if (!(err instanceof SenseError) || err.code !== 'mfa_required') {
              throw err;
            }
          }
        }
        if (this.client.mfaToken) {
          await this.client.verifyMfa(code);
        }
      } catch (err) {
        if (err instanceof SenseError && err.code === 'bad_mfa') {
          return T.mfa.refused;
        }
        return this.messageOf(err);
      }
      // Queued after this job: the action does not wait for the start.
      this.start(this.raw).catch((err) => this.logger.warn(`Sense start: ${err.message}`));
      return T.mfa.ok;
    });
  }
}
