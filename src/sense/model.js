// -----------------------------------------------------------------------------
// The Sense answers turned into plain values. Pure.
//
// Ported from sense-energy (scottbonline/sense, MIT): the filtering of the
// detected devices (`fetch_devices`), the realtime payload (`_set_realtime`),
// the hourly breakdown of a DAY answer (`_transform_hour_response`) and the
// `start` parameter of the trends (`_format_trend_start`).
// -----------------------------------------------------------------------------

const num = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : null);
const round = (value, digits) => {
  const n = num(value);
  if (n === null) {
    return null;
  }
  const f = 10 ** digits;
  return Math.round(n * f) / f;
};

/** The monitor description, from an `authenticate` monitor or an `overview` answer. */
export function monitorOf(overview, fallback = {}) {
  const raw = overview?.monitor_overview?.monitor ?? overview ?? {};
  const id = raw.id ?? fallback.id;
  return {
    id: id === undefined || id === null ? '' : String(id),
    serial: String(raw.serial_number ?? fallback.serial ?? ''),
    timeZone: String(raw.time_zone ?? fallback.timeZone ?? ''),
    solar:
      raw.solar_configured === undefined ? Boolean(fallback.solar) : raw.solar_configured === true,
  };
}

/**
 * The devices Sense detected, as its app lists them: hidden and merged ones
 * left out, a smart plug seen several times kept once (its latest record).
 */
export function appliancesOf(overview) {
  const list = Array.isArray(overview?.devices) ? overview.devices : [];
  const result = new Map();
  const plugs = new Map();
  for (const device of list) {
    if (!device || device.id === undefined || device.id === null) {
      continue;
    }
    const tags = device.tags ?? {};
    if (tags.DeviceListAllowed === false || tags.DeviceListAllowed === 'false' || tags.MergeId) {
      continue;
    }
    if (tags.DefaultUserDeviceType === 'SmartPlug') {
      const known = plugs.get(device.name);
      if (!known || String(tags.DateCreated ?? '') > String(known.tags?.DateCreated ?? '')) {
        plugs.set(device.name, device);
      }
      continue;
    }
    result.set(String(device.id), device);
  }
  for (const device of plugs.values()) {
    result.set(String(device.id), device);
  }
  return [...result.values()].map((d) => ({
    id: String(d.id),
    name: String(d.name || d.id),
    icon: String(d.icon ?? ''),
  }));
}

/**
 * A `realtime_update` payload: consumed power `w`, produced power `solar_w`,
 * the grid exchange (`grid_w`, else `w` - `solar_w`),
 * the voltage of each leg, the frequency, the power of each detected device.
 * `devices` is undefined when the payload lists none (sense-energy keeps the
 * previous values then).
 */
export function liveOf(payload = {}) {
  const voltage = Array.isArray(payload.voltage) ? payload.voltage : [];
  const devices =
    Array.isArray(payload.devices) && payload.devices.length > 0 ? new Map() : undefined;
  for (const d of devices ? payload.devices : []) {
    const w = num(Number(d?.w));
    if (d && d.id !== undefined && d.id !== null && w !== null) {
      devices.set(String(d.id), Math.max(0, Math.round(w)));
    }
  }
  const power = num(payload.w);
  const solar = num(payload.solar_w);
  // Grid exchange, signed (import > 0, export < 0): the feed's own value when
  // it gives one, else consumed minus produced.
  const gridRaw = num(payload.grid_w) ?? (power === null ? null : power - (solar ?? 0));
  return {
    power: power === null ? null : Math.max(0, Math.round(power)),
    production: solar === null ? null : Math.max(0, Math.round(solar)),
    voltage: [round(voltage[0], 1), round(voltage[1], 1)],
    frequency: round(payload.hz, 2),
    grid: gridRaw === null ? null : Math.round(gridRaw),
    devices,
  };
}

/**
 * The 30-minute consumption intervals of a DAY answer: one value per clock
 * hour of the monitor's day (23 or 25 across a DST change, counted from the
 * answer's own `start`), split in two halves. Only the hours already over at
 * `now` are returned: the current one is still filling.
 */
export function halfHoursOf(usage, now) {
  const start = Date.parse(usage?.start ?? '');
  const hours = usage?.consumption?.usage_breakdown_kwh;
  if (!Number.isFinite(start) || !Array.isArray(hours)) {
    return [];
  }
  const intervals = [];
  hours.forEach((value, index) => {
    const kwh = num(value);
    const from = start + index * 60 * 60_000;
    if (kwh === null || kwh < 0 || from + 60 * 60_000 > now) {
      return;
    }
    const half = Math.round((kwh / 2) * 100000) / 100000;
    intervals.push(
      { starts_at: new Date(from).toISOString(), kwh: half },
      { starts_at: new Date(from + 30 * 60_000).toISOString(), kwh: half },
    );
  });
  return intervals;
}

/** The `start` parameter of a trend: the instant in UTC, without zone nor milliseconds. */
export function trendStart(instant) {
  return new Date(instant).toISOString().slice(0, 19);
}
