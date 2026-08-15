export const PLATFORM_NAME = 'TerraMowV600';
export const PLUGIN_NAME = 'homebridge-terramow-v600';

export const MQTT_USERNAME = 'terramow';
export const MQTT_DEFAULT_PORT = 1883;

/** Data points used by this plugin. */
export const DP = {
  BATTERY_LEVEL: 8,
  START_COMMAND: 103,
  PAUSE_COMMAND: 105,
  RESUME_COMMAND: 106,
  TASK_STATUS: 107,
  BATTERY_STATUS: 108,
  CURRENT_OPERATION: 113,
  MAP_STATUS: 117,
  STATISTICS: 124,
  BASE_STATION_TIME: 125,
  BLADE_TIME: 126,
  COMPATIBILITY: 127,
  SCHEDULE: 138,
} as const;

/** Recommended maintenance intervals from TerraMow HA docs (minutes). */
export const BLADE_MAINTENANCE_CYCLE_MINUTES = 14400;
export const BASE_STATION_MAINTENANCE_CYCLE_MINUTES = 43200;

export const TOPIC = {
  MODEL_NAME: 'model/name',
  robot: (dpId: number) => `data_point/${dpId}/robot`,
  app: (dpId: number) => `data_point/${dpId}/app`,
} as const;

export const START_MODE = {
  GLOBAL_CLEAN: 'START_MODE_GLOBAL_CLEAN',
  RETURN: 'START_MODE_RETURN',
} as const;
