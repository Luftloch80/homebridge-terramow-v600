import {
  MOW_MISSIONS,
  RECHARGE_MISSIONS,
  type BatteryStatus,
  type CurrentOperation,
  type MowerActivity,
  type MowerState,
  type TaskStatus,
} from './types.js';

export function createInitialState(): MowerState {
  return {
    connected: false,
    modelName: 'TerraMow V600',
    batteryLevel: 100,
    batteryStatus: {
      state: 'BATTERY_STATE_DISCHARGE',
      chargerConnected: false,
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

export function parseBatteryStatus(payload: unknown): BatteryStatus | null {
  if (!payload || typeof payload !== 'object') {
    return null;
  }
  const data = payload as Record<string, unknown>;
  return {
    state: typeof data.state === 'string' ? data.state : 'BATTERY_STATE_DISCHARGE',
    chargerConnected: Boolean(data.charger_connected),
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
