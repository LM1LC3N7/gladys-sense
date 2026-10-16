// -----------------------------------------------------------------------------
// The Gladys devices of a Sense monitor and of the devices Sense detected, and
// their states. Pure.
//
// External ids (forever):
//   monitor:<Sense monitor id>                       the monitor
//   appliance:<Sense monitor id>_<Sense device id>   a device Sense detected (option)
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES as C,
  DEVICE_FEATURE_TYPES as T,
  DEVICE_FEATURE_UNITS as U,
} from '@gladysassistant/integration-sdk';

/** Feature keys (forever). */
export const FEATURE = {
  POWER: 'power',
  PRODUCTION: 'production_power',
  VOLTAGE_1: 'voltage_l1',
  VOLTAGE_2: 'voltage_l2',
  FREQUENCY: 'frequency',
  CONSUMPTION: 'consumption',
  TODAY_CONSUMPTION: 'today_consumption',
  TODAY_PRODUCTION: 'today_production',
  TODAY_FROM_GRID: 'today_from_grid',
  TODAY_TO_GRID: 'today_to_grid',
  // a detected device
  APPLIANCE_POWER: 'power',
  APPLIANCE_ON: 'on',
};

export const ids = {
  monitor: (gladys, monitorId) => gladys.externalIds('monitor', monitorId),
  appliance: (gladys, monitorId, deviceId) =>
    gladys.externalIds('appliance', `${monitorId}_${deviceId}`),
};

const feature = (externalId, name, category, type, extra = {}) => ({
  name,
  external_id: externalId,
  category,
  type,
  min: 0,
  max: 100000,
  read_only: true,
  has_feedback: false,
  keep_history: true,
  ...extra,
});

/** The device of a monitor. `monitor` = { id, serial, timeZone, solar }. */
export function buildMonitorDevice(gladys, monitor) {
  const id = ids.monitor(gladys, monitor.id);
  const kwh = { unit: U.KILOWATT_HOUR, max: 10000 };
  const features = [
    feature(id.feature(FEATURE.POWER), 'Power consumed', C.ENERGY_SENSOR, T.ENERGY_SENSOR.POWER, {
      unit: U.WATT,
    }),
    feature(id.feature(FEATURE.VOLTAGE_1), 'Voltage L1', C.ENERGY_SENSOR, T.ENERGY_SENSOR.VOLTAGE, {
      unit: U.VOLT,
      max: 500,
    }),
    feature(id.feature(FEATURE.VOLTAGE_2), 'Voltage L2', C.ENERGY_SENSOR, T.ENERGY_SENSOR.VOLTAGE, {
      unit: U.VOLT,
      max: 500,
    }),
    // Gladys has no frequency type nor hertz unit: a plain decimal sensor.
    feature(id.feature(FEATURE.FREQUENCY), 'Frequency (Hz)', C.UNKNOWN, T.SENSOR.DECIMAL, {
      max: 100,
    }),
    feature(
      id.feature(FEATURE.CONSUMPTION),
      'Consumption (30 min)',
      C.ENERGY_SENSOR,
      T.ENERGY_SENSOR.THIRTY_MINUTES_CONSUMPTION,
      { unit: U.KILOWATT_HOUR, max: 1000 },
    ),
    feature(
      id.feature(FEATURE.TODAY_CONSUMPTION),
      "Today's consumption",
      C.ENERGY_SENSOR,
      T.ENERGY_SENSOR.DAILY_CONSUMPTION,
      kwh,
    ),
  ];
  if (monitor.solar) {
    features.push(
      feature(
        id.feature(FEATURE.PRODUCTION),
        'Power produced',
        C.ENERGY_PRODUCTION_SENSOR,
        T.ENERGY_PRODUCTION_SENSOR.POWER,
        { unit: U.WATT },
      ),
      feature(
        id.feature(FEATURE.TODAY_PRODUCTION),
        "Today's production",
        C.ENERGY_PRODUCTION_SENSOR,
        T.ENERGY_PRODUCTION_SENSOR.DAILY_PRODUCTION,
        kwh,
      ),
      feature(
        id.feature(FEATURE.TODAY_FROM_GRID),
        'Imported from the grid today',
        C.ENERGY_SENSOR,
        T.ENERGY_SENSOR.ENERGY,
        kwh,
      ),
      feature(
        id.feature(FEATURE.TODAY_TO_GRID),
        'Exported to the grid today',
        C.ENERGY_SENSOR,
        T.ENERGY_SENSOR.ENERGY,
        kwh,
      ),
    );
  }
  return {
    name: `Sense ${monitor.serial || monitor.id}`,
    external_id: id.device,
    features,
    params: [
      { name: 'monitor_id', value: monitor.id },
      { name: 'time_zone', value: monitor.timeZone ?? '' },
      { name: 'solar', value: monitor.solar ? 'true' : 'false' },
    ],
  };
}

/** The device of an appliance Sense detected: on/off and power, read only. */
export function buildApplianceDevice(gladys, monitor, appliance) {
  const id = ids.appliance(gladys, monitor.id, appliance.id);
  return {
    name: `Sense ${appliance.name}`,
    external_id: id.device,
    features: [
      feature(id.feature(FEATURE.APPLIANCE_ON), 'On', C.ENERGY_SENSOR, T.ENERGY_SENSOR.BINARY, {
        max: 1,
        keep_history: true,
      }),
      feature(
        id.feature(FEATURE.APPLIANCE_POWER),
        'Power',
        C.ENERGY_SENSOR,
        T.ENERGY_SENSOR.POWER,
        { unit: U.WATT },
      ),
    ],
    params: [
      { name: 'monitor_id', value: monitor.id },
      { name: 'sense_device_id', value: appliance.id },
    ],
  };
}

const state = (externalId, value) =>
  value === null || value === undefined || !Number.isFinite(value)
    ? []
    : [{ device_feature_external_id: externalId, state: value }];

/** The live states of the monitor (src/sense/model.js `liveOf`). */
export function liveStates(gladys, monitor, live) {
  const id = ids.monitor(gladys, monitor.id);
  return [
    ...state(id.feature(FEATURE.POWER), live.power),
    ...(monitor.solar ? state(id.feature(FEATURE.PRODUCTION), live.production) : []),
    ...state(id.feature(FEATURE.VOLTAGE_1), live.voltage[0]),
    ...state(id.feature(FEATURE.VOLTAGE_2), live.voltage[1]),
    ...state(id.feature(FEATURE.FREQUENCY), live.frequency),
  ];
}

/** Today's totals of the monitor (src/sense/model.js `dayTotals`). */
export function totalStates(gladys, monitor, totals) {
  const id = ids.monitor(gladys, monitor.id);
  return [
    ...state(id.feature(FEATURE.TODAY_CONSUMPTION), totals.consumption),
    ...(monitor.solar
      ? [
          ...state(id.feature(FEATURE.TODAY_PRODUCTION), totals.production),
          ...state(id.feature(FEATURE.TODAY_FROM_GRID), totals.fromGrid),
          ...state(id.feature(FEATURE.TODAY_TO_GRID), totals.toGrid),
        ]
      : []),
  ];
}

/** The on/off (and, with `withPower`, the power) of the known appliances. */
export function applianceStates(gladys, monitor, appliances, powers, { withPower }) {
  const states = [];
  for (const appliance of appliances) {
    const id = ids.appliance(gladys, monitor.id, appliance.id);
    const power = powers.get(appliance.id) ?? 0;
    states.push(...state(id.feature(FEATURE.APPLIANCE_ON), power > 0 ? 1 : 0));
    if (withPower) {
      states.push(...state(id.feature(FEATURE.APPLIANCE_POWER), power));
    }
  }
  return states;
}
