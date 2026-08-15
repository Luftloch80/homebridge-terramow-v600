export interface MowerConfig {
  name: string;
  host: string;
  password: string;
  port?: number;
  lowBatteryThreshold?: number;
  showPauseSwitch?: boolean;
  showDockSwitch?: boolean;
  showSensors?: boolean;
}

export interface PlatformPluginConfig {
  name?: string;
  mowers?: MowerConfig[];
  // Legacy single-mower fields (still supported)
  host?: string;
  password?: string;
  port?: number;
  lowBatteryThreshold?: number;
  showPauseSwitch?: boolean;
  showDockSwitch?: boolean;
  showSensors?: boolean;
}

export type Mission =
  | 'MISSION_IDLE'
  | 'MISSION_RECHARGE'
  | 'MISSION_GLOBAL_CLEAN'
  | 'MISSION_BUILD_MAP'
  | 'MISSION_BUILD_MAP_AND_CLEAN'
  | 'MISSION_TEMPORARY_CLEAN'
  | 'MISSION_BACK_TO_STARTING_POINT'
  | 'MISSION_REMOTE_CONTROL_CLEAN'
  | 'MISSION_SCHEDULE_GLOBAL_CLEAN'
  | 'MISSION_SCHEDULE_BUILD_MAP_AND_CLEAN'
  | 'MISSION_SELECT_REGION_CLEAN'
  | 'MISSION_CREATE_CUSTOM_PASSAGE'
  | 'MISSION_BACKUP_MAP'
  | 'MISSION_RELOCATE_BASE_STATION'
  | 'MISSION_USER_AUTO_CALIBRATION'
  | 'MISSION_RESTORE_BACKUP_MAP'
  | 'MISSION_SCHEDULE_SELECT_REGION_CLEAN'
  | 'MISSION_DRAW_REGION_CLEAN'
  | 'MISSION_EDGE_TRIM_CLEAN'
  | 'MISSION_UPDATE_BACKUP_MAP'
  | 'MISSION_USER_TRIGGERED_SELF_CALIBRATION'
  | string;

export type SubMission =
  | 'SUB_MISSION_IDLE'
  | 'SUB_MISSION_RELOCATION'
  | 'SUB_MISSION_RETURN_TO_BASE'
  | 'SUB_MISSION_OUT_OF_STATION'
  | 'SUB_MISSION_REMOTE_CONTROL'
  | 'SUB_MISSION_SAVING_MAP'
  | 'SUB_MISSION_SETTING_BLADE_HEIGHT'
  | 'SUB_MISSION_DEFOGGING'
  | 'SUB_MISSION_WAIT_FOR_DAYLIGHT'
  | 'SUB_MISSION_COOLING_DOWN_MOTOR'
  | 'SUB_MISSION_FLEXIBLE_STATION_WAIT'
  | string;

export type MissionState =
  | 'MISSION_STATE_IDLE'
  | 'MISSION_STATE_RUNNING'
  | 'MISSION_STATE_PAUSE'
  | 'MISSION_STATE_ABORT'
  | 'MISSION_STATE_COMPLETE'
  | string;

export type BatteryChargeState =
  | 'BATTERY_STATE_DISCHARGE'
  | 'BATTERY_STATE_CHARGING'
  | 'BATTERY_STATE_CHARGED'
  | string;

export type BatteryTemperature =
  | 'BATTERY_TEMPRETURE_NORMAL'
  | 'BATTERY_TEMPRETURE_OVERHEAT'
  | 'BATTERY_TEMPRETURE_UNDERHEAT'
  | string;

export type BackToStationReason =
  | 'BACK_TO_STATION_REASON_NONE'
  | 'BACK_TO_STATION_REASON_LOW_BATTERY'
  | 'BACK_TO_STATION_REASON_RAINING'
  | 'BACK_TO_STATION_REASON_MOW_MOTOR_OVERHEAT'
  | 'BACK_TO_STATION_REASON_WHEEL_OVERHEAT'
  | 'BACK_TO_STATION_REASON_NIGHT_TIME'
  | string;

export interface TaskStatus {
  mission: Mission;
  subMission: SubMission;
  state: MissionState;
  hasError: boolean;
  backToStationReason: BackToStationReason;
}

export interface BatteryStatus {
  state: BatteryChargeState;
  chargerConnected: boolean;
  temperature: BatteryTemperature;
  powerSwitchOn: boolean;
}

export interface CurrentOperation {
  totalArea: number;
  cleanArea: number;
  workDuration: number;
  progressPercent: number;
}

export interface Statistics {
  durationSeconds: number;
  cleanArea: number;
  cleanTimes: number;
}

export interface MapStatus {
  mapDetected: boolean;
  mapState: string;
  mapId: number;
  mapNumber: number;
}

export interface UpcomingSchedule {
  exist: boolean;
  startHour: number;
  startMinute: number;
  endHour: number;
  endMinute: number;
}

export type MowerActivity =
  | 'docked'
  | 'mowing'
  | 'paused'
  | 'returning'
  | 'error'
  | 'unknown';

export interface MowerState {
  connected: boolean;
  modelName: string;
  batteryLevel: number;
  batteryStatus: BatteryStatus;
  task: TaskStatus;
  operation: CurrentOperation;
  statistics: Statistics;
  mapStatus: MapStatus;
  schedule: UpcomingSchedule;
  bladeMinutes: number;
  baseStationMinutes: number;
  activity: MowerActivity;
}

export const MOW_MISSIONS = new Set<string>([
  'MISSION_GLOBAL_CLEAN',
  'MISSION_BUILD_MAP_AND_CLEAN',
  'MISSION_TEMPORARY_CLEAN',
  'MISSION_REMOTE_CONTROL_CLEAN',
  'MISSION_SCHEDULE_GLOBAL_CLEAN',
  'MISSION_SCHEDULE_BUILD_MAP_AND_CLEAN',
  'MISSION_SELECT_REGION_CLEAN',
  'MISSION_SCHEDULE_SELECT_REGION_CLEAN',
  'MISSION_DRAW_REGION_CLEAN',
  'MISSION_EDGE_TRIM_CLEAN',
]);

export const RECHARGE_MISSIONS = new Set<string>([
  'MISSION_RECHARGE',
  'MISSION_BACK_TO_STARTING_POINT',
]);
