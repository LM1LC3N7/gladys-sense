// -----------------------------------------------------------------------------
// Sample Sense answers, shaped after what sense-energy (scottbonline/sense)
// reads: synthetic values, never captured from a real account.
// -----------------------------------------------------------------------------

export const MONITOR_ID = '123456';
export const SERIAL = 'N123A456';
// The fake Gladys checks that a consumption interval is elapsed and at most
// five years old against the real clock: the sample day is two days ago, so
// the tests keep passing whatever the date. The monitor is in a UTC-4 zone.
const DAY = 24 * 60 * 60_000;
const BASE = Math.floor(Date.now() / DAY) * DAY - 2 * DAY;
const iso = (ms) => new Date(ms).toISOString();
/** 14:20 local time (UTC-4). */
export const NOW = BASE + 18 * 60 * 60_000 + 20 * 60_000;
export const TODAY_START = iso(BASE + 4 * 60 * 60_000);
export const YESTERDAY_START = iso(BASE + 4 * 60 * 60_000 - DAY);
/** An instant `hours` after today's local midnight, as an ISO string. */
export const at = (hours) => iso(Date.parse(TODAY_START) + hours * 60 * 60_000);

export const auth = (overrides = {}) => ({
  authorized: true,
  account_id: 98765,
  user_id: 4242,
  access_token: 'acc-1',
  refresh_token: 'ref-1',
  monitors: [
    {
      id: Number(MONITOR_ID),
      serial_number: SERIAL,
      time_zone: 'America/New_York',
      solar_configured: true,
    },
  ],
  ...overrides,
});

export const mfaChallenge = {
  status: 'error',
  error_reason: 'Multi-factor authentication required',
  mfa_token: 'mfa-tok',
};

export const overview = ({ solar = true } = {}) => ({
  monitor_overview: {
    monitor: {
      id: Number(MONITOR_ID),
      serial_number: SERIAL,
      time_zone: 'America/New_York',
      solar_configured: solar,
    },
  },
});

export const devicesOverview = () => ({
  devices: [
    { id: 'fridge1', name: 'Fridge', icon: 'fridge', tags: { DeviceListAllowed: 'true' } },
    { id: 'always_on', name: 'Always On', icon: 'alwayson', tags: {} },
    { id: 'hidden1', name: 'Hidden', icon: 'socket', tags: { DeviceListAllowed: false } },
    { id: 'merged1', name: 'Old dryer', icon: 'dryer', tags: { MergeId: 'dryer2' } },
    {
      id: 'plug-old',
      name: 'Desk plug',
      icon: 'socket',
      tags: { DefaultUserDeviceType: 'SmartPlug', DateCreated: '2024-01-01T00:00:00.000Z' },
    },
    {
      id: 'plug-new',
      name: 'Desk plug',
      icon: 'socket',
      tags: { DefaultUserDeviceType: 'SmartPlug', DateCreated: '2025-06-01T00:00:00.000Z' },
    },
  ],
});

/** A DAY usage answer: `hours` values from `start`. */
export const usage = (start, hours, total = hours.reduce((a, b) => a + b, 0)) => ({
  start,
  end: null,
  consumption: { usage_total_kwh: total, usage_breakdown_kwh: hours },
  device_breakdown: [],
});

/** Today: 14 finished hours of 1 kWh, the 15th (14:00-15:00 local) filling, the rest empty. */
export const todayUsage = () =>
  usage(TODAY_START, [...Array(14).fill(1), 0.4, ...Array(9).fill(0)], 14.4);
export const yesterdayUsage = () => usage(YESTERDAY_START, Array(24).fill(0.5), 12);

export const solarUsage = () => ({
  start: TODAY_START,
  total: {
    from_grid_kwh: 6.2,
    to_grid_kwh: 3.1,
    production_kwh: 11.3,
    net_kwh: -3.1,
    solar_percentage: 57,
  },
  breakdown: { net_kwh: [], production_kwh: [] },
});

export const realtime = (overrides = {}) => ({
  voltage: [121.34, 120.87],
  frame: 1234,
  devices: [
    { id: 'fridge1', name: 'Fridge', icon: 'fridge', w: 143.6 },
    { id: 'always_on', name: 'Always On', icon: 'alwayson', w: 210 },
  ],
  hz: 59.987,
  w: 2500.4,
  c: 2500,
  solar_w: 1800.6,
  epoch: 1792000000,
  ...overrides,
});
