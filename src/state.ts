import {
  MOW_MISSIONS,
  RECHARGE_MISSIONS,
  type BatteryStatus,
  type CurrentOperation,
  type MapStatus,
  type MowerActivity,
  type MowerState,
  type Statistics,
  type TaskStatus,
  type UpcomingSchedule,
} from './types.js';
import {
  BASE_STATION_MAINTENANCE_CYCLE_MINUTES,
  BLADE_MAINTENANCE_CYCLE_MINUTES,
} from './settings.js';

export function createInitialState(): MowerState {
  return {
    connected: false,
    modelName: 'TerraMow V600',
    firmwareRevision: '',
    batteryLevel: 100,
    batteryStatus: {
      state: 'BATTERY_STATE_DISCHARGE',
      chargerConnected: false,
      temperature: 'BATTERY_TEMPRETURE_NORMAL',
      powerSwitchOn: true,
    },
    task: {
      mission: 'MISSION_IDLE',
      subMission: 'SUB_MISSION_IDLE',
      state: 'MISSION_STATE_IDLE',
      hasError: false,
      backToStationReason: 'BACK_TO_STATION_REASON_NONE',
    },
    operation: {
      totalArea: 0,
      cleanArea: 0,
      workDuration: 0,
      progressPercent: 0,
    },
    statistics: {
      durationSeconds: 0,
      cleanArea: 0,
      cleanTimes: 0,
    },
    mapStatus: {
      mapDetected: false,
      mapState: 'MAP_STATE_EMPTY',
      mapId: 0,
      mapNumber: 0,
    },
    schedule: {
      exist: false,
      startHour: 0,
      startMinute: 0,
      endHour: 0,
      endMinute: 0,
    },
    bladeMinutes: 0,
    baseStationMinutes: 0,
    activity: 'unknown',
  };
}

export function parseBatteryLevel(payload: unknown): number | null {
  if (!payload || typeof payload !== 'object') {
    return null;
  }
  const value = (payload as { int_value?: unknown }).int_value;
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return null;
  }
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function parseIntValueMinutes(payload: unknown): number | null {
  if (!payload || typeof payload !== 'object') {
    return null;
  }
  const value = (payload as { int_value?: unknown }).int_value;
  if (typeof value !== 'number' || Number.isNaN(value) || value < 0) {
    return null;
  }
  return Math.round(value);
}

export function parseBatteryStatus(payload: unknown): BatteryStatus | null {
  if (!payload || typeof payload !== 'object') {
    return null;
  }
  const data = payload as Record<string, unknown>;
  return {
    state: typeof data.state === 'string' ? data.state : 'BATTERY_STATE_DISCHARGE',
    chargerConnected: Boolean(data.charger_connected),
    temperature:
      typeof data.tempreture === 'string'
        ? data.tempreture
        : 'BATTERY_TEMPRETURE_NORMAL',
    powerSwitchOn: data.is_switch_on === undefined ? true : Boolean(data.is_switch_on),
  };
}

export function parseTaskStatus(payload: unknown): TaskStatus | null {
  if (!payload || typeof payload !== 'object') {
    return null;
  }
  const data = payload as Record<string, unknown>;
  return {
    mission: typeof data.mission === 'string' ? data.mission : 'MISSION_IDLE',
    subMission: typeof data.sub_mission === 'string' ? data.sub_mission : 'SUB_MISSION_IDLE',
    state: typeof data.state === 'string' ? data.state : 'MISSION_STATE_IDLE',
    hasError: Boolean(data.has_error),
    backToStationReason:
      typeof data.back_to_station_reason === 'string'
        ? data.back_to_station_reason
        : 'BACK_TO_STATION_REASON_NONE',
  };
}

export function parseCurrentOperation(payload: unknown): CurrentOperation | null {
  if (!payload || typeof payload !== 'object') {
    return null;
  }
  const data = payload as Record<string, unknown>;
  const totalArea = typeof data.total_area === 'number' ? data.total_area : 0;
  const cleanArea = typeof data.clean_area === 'number' ? data.clean_area : 0;
  const workDuration = typeof data.work_duration === 'number' ? data.work_duration : 0;
  const isCompleted = Boolean(data.is_completed);

  let progressPercent = 0;
  if (isCompleted) {
    progressPercent = 100;
  } else if (totalArea > 0) {
    progressPercent = Math.max(0, Math.min(100, Math.round((cleanArea / totalArea) * 100)));
  }

  return { totalArea, cleanArea, workDuration, progressPercent };
}

export function parseStatistics(payload: unknown): Statistics | null {
  if (!payload || typeof payload !== 'object') {
    return null;
  }
  const data = payload as Record<string, unknown>;
  return {
    durationSeconds: typeof data.duration === 'number' ? data.duration : 0,
    cleanArea: typeof data.clean_area === 'number' ? data.clean_area : 0,
    cleanTimes: typeof data.clean_times === 'number' ? data.clean_times : 0,
  };
}

export function parseMapStatus(payload: unknown): MapStatus | null {
  if (!payload || typeof payload !== 'object') {
    return null;
  }
  const data = payload as Record<string, unknown>;
  return {
    mapDetected: Boolean(data.is_map_detected),
    mapState: typeof data.map_state === 'string' ? data.map_state : 'MAP_STATE_EMPTY',
    mapId: typeof data.map_id === 'number' ? data.map_id : 0,
    mapNumber: typeof data.map_number === 'number' ? data.map_number : 0,
  };
}

export function parseSchedule(payload: unknown): UpcomingSchedule | null {
  if (!payload || typeof payload !== 'object') {
    return null;
  }
  const data = payload as Record<string, unknown>;
  const start = (data.start_time && typeof data.start_time === 'object'
    ? data.start_time
    : {}) as Record<string, unknown>;
  const end = (data.end_time && typeof data.end_time === 'object'
    ? data.end_time
    : {}) as Record<string, unknown>;
  return {
    exist: Boolean(data.exist),
    startHour: typeof start.hour === 'number' ? start.hour : 0,
    startMinute: typeof start.minute === 'number' ? start.minute : 0,
    endHour: typeof end.hour === 'number' ? end.hour : 0,
    endMinute: typeof end.minute === 'number' ? end.minute : 0,
  };
}

export function deriveActivity(task: TaskStatus, connected: boolean): MowerActivity {
  if (!connected) {
    return 'error';
  }
  if (task.hasError) {
    return 'error';
  }

  if (task.state === 'MISSION_STATE_PAUSE') {
    return 'paused';
  }

  if (task.state === 'MISSION_STATE_RUNNING') {
    if (
      task.subMission === 'SUB_MISSION_RETURN_TO_BASE' ||
      RECHARGE_MISSIONS.has(task.mission)
    ) {
      return 'returning';
    }
    if (MOW_MISSIONS.has(task.mission)) {
      return 'mowing';
    }
    if (RECHARGE_MISSIONS.has(task.mission)) {
      return 'returning';
    }
  }

  if (
    task.mission === 'MISSION_IDLE' ||
    task.state === 'MISSION_STATE_IDLE' ||
    task.state === 'MISSION_STATE_COMPLETE' ||
    task.state === 'MISSION_STATE_ABORT'
  ) {
    return 'docked';
  }

  if (RECHARGE_MISSIONS.has(task.mission)) {
    return task.state === 'MISSION_STATE_PAUSE' ? 'paused' : 'returning';
  }

  if (MOW_MISSIONS.has(task.mission)) {
    return 'mowing';
  }

  return 'unknown';
}

export function isMowingActivity(activity: MowerActivity): boolean {
  return activity === 'mowing' || activity === 'paused';
}

export function isCharging(status: BatteryStatus): boolean {
  return status.state === 'BATTERY_STATE_CHARGING' || status.state === 'BATTERY_STATE_CHARGED';
}

export function isRainDelay(task: TaskStatus): boolean {
  return task.backToStationReason === 'BACK_TO_STATION_REASON_RAINING';
}

export function isAtBase(activity: MowerActivity, battery: BatteryStatus): boolean {
  return activity === 'docked' || battery.chargerConnected;
}

export function isBatteryTempAbnormal(status: BatteryStatus): boolean {
  return status.temperature !== 'BATTERY_TEMPRETURE_NORMAL';
}

export function isWaitingDaylight(task: TaskStatus): boolean {
  return (
    task.subMission === 'SUB_MISSION_WAIT_FOR_DAYLIGHT' ||
    task.backToStationReason === 'BACK_TO_STATION_REASON_NIGHT_TIME'
  );
}

export function isOverheatReturn(task: TaskStatus): boolean {
  return (
    task.backToStationReason === 'BACK_TO_STATION_REASON_MOW_MOTOR_OVERHEAT' ||
    task.backToStationReason === 'BACK_TO_STATION_REASON_WHEEL_OVERHEAT'
  );
}

export function filterLifePercent(usedMinutes: number, cycleMinutes: number): number {
  if (cycleMinutes <= 0) {
    return 100;
  }
  const remaining = 1 - usedMinutes / cycleMinutes;
  return Math.max(0, Math.min(100, Math.round(remaining * 100)));
}

export function bladeFilterLife(bladeMinutes: number): number {
  return filterLifePercent(bladeMinutes, BLADE_MAINTENANCE_CYCLE_MINUTES);
}

export function baseStationFilterLife(baseMinutes: number): number {
  return filterLifePercent(baseMinutes, BASE_STATION_MAINTENANCE_CYCLE_MINUTES);
}

/** Map cleaned area (0.1 m² units) into a 0.0001–100000 lux-ish light level for HomeKit. */
export function areaToLightLevel(cleanAreaTenths: number): number {
  const sqm = Math.max(0, cleanAreaTenths) / 10;
  return Math.max(0.0001, Math.min(100000, sqm));
}

/**
 * DP 127 compatibility / firmware payload.
 * Same formatting as TerraMowHA: `{overall}.{home_assistant}` when HA module present.
 */
export function parseCompatibilityInfo(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') {
    return null;
  }
  const data = payload as Record<string, unknown>;
  const overall = data.overall;
  if (typeof overall !== 'number' || Number.isNaN(overall)) {
    return null;
  }

  const moduleInfo = data.module;
  if (moduleInfo && typeof moduleInfo === 'object') {
    const haVersion = (moduleInfo as Record<string, unknown>).home_assistant;
    if (typeof haVersion === 'number' && !Number.isNaN(haVersion)) {
      return `${overall}.${haVersion}`;
    }
  }

  return String(overall);
}
