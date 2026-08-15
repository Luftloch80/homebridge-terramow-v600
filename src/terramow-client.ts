import { EventEmitter } from 'node:events';
import mqtt, { type IClientOptions, type MqttClient } from 'mqtt';

import { DP, MQTT_DEFAULT_PORT, MQTT_USERNAME, START_MODE, TOPIC } from './settings.js';
import {
  createInitialState,
  deriveActivity,
  parseBatteryLevel,
  parseBatteryStatus,
  parseCurrentOperation,
  parseIntValueMinutes,
  parseMapStatus,
  parseSchedule,
  parseStatistics,
  parseTaskStatus,
} from './state.js';
import type { MowerState } from './types.js';

export interface TerraMowClientOptions {
  host: string;
  password: string;
  port?: number;
  logger?: {
    info: (message: string) => void;
    warn: (message: string) => void;
    error: (message: string) => void;
    debug: (message: string) => void;
  };
}

export type TerraMowClientEvents = {
  state: [MowerState];
  connected: [boolean];
  error: [Error];
};

/**
 * Local MQTT client for TerraMow's on-device broker.
 * Username is always `terramow`; password comes from the TerraMow app HA setting.
 */
export class TerraMowClient extends EventEmitter {
  private client: MqttClient | null = null;
  private cmdSeq = Math.floor(Math.random() * 0xffffffff);
  private lastCommandAt = 0;
  private readonly minCommandIntervalMs = 800;
  private readonly log: NonNullable<TerraMowClientOptions['logger']>;
  private state: MowerState = createInitialState();
  private destroyed = false;

  constructor(private readonly options: TerraMowClientOptions) {
    super();
    this.log = options.logger ?? {
      info: () => undefined,
      warn: () => undefined,
      error: () => undefined,
      debug: () => undefined,
    };
  }

  getState(): MowerState {
    return this.state;
  }

  start(): void {
    if (this.client || this.destroyed) {
      return;
    }

    const port = this.options.port ?? MQTT_DEFAULT_PORT;
    const url = `mqtt://${this.options.host}:${port}`;
    const mqttOptions: IClientOptions = {
      username: MQTT_USERNAME,
      password: this.options.password,
      keepalive: 30,
      reconnectPeriod: 5000,
      connectTimeout: 10_000,
      clean: true,
      clientId: `homebridge-terramow-${Math.random().toString(16).slice(2, 10)}`,
    };

    this.log.info(`Connecting to TerraMow MQTT broker at ${url}`);
    this.client = mqtt.connect(url, mqttOptions);

    this.client.on('connect', () => {
      this.log.info('Connected to TerraMow MQTT broker');
      this.updateState({ connected: true });
      this.subscribeAll();
      this.requestCompatibilityInfo();
    });

    this.client.on('reconnect', () => {
      this.log.debug('Reconnecting to TerraMow MQTT broker');
    });

    this.client.on('close', () => {
      this.log.warn('TerraMow MQTT connection closed');
      this.updateState({ connected: false });
    });

    this.client.on('error', (error: Error) => {
      this.log.error(`TerraMow MQTT error: ${error.message}`);
      this.emit('error', error);
      this.updateState({ connected: false });
    });

    this.client.on('message', (topic: string, payloadBuf: Buffer) => {
      this.handleMessage(topic, payloadBuf.toString('utf8'));
    });
  }

  stop(): void {
    this.destroyed = true;
    if (!this.client) {
      return;
    }
    const client = this.client;
    this.client = null;
    client.end(true);
    this.updateState({ connected: false });
  }

  startMowing(): boolean {
    if (!this.canAcceptCommand()) {
      return false;
    }

    const { task } = this.state;
    if (MOW_MISSIONS_RUNTIME.has(task.mission)) {
      if (
        task.subMission === 'SUB_MISSION_FLEXIBLE_STATION_WAIT' ||
        task.state === 'MISSION_STATE_PAUSE'
      ) {
        return this.resume();
      }
      if (task.state === 'MISSION_STATE_RUNNING') {
        this.log.debug('Already mowing; ignoring start');
        return true;
      }
    }

    return this.publish(DP.START_COMMAND, {
      seq: this.nextSeq(),
      mode: START_MODE.GLOBAL_CLEAN,
      global_clean: { restart: false },
    });
  }

  pause(): boolean {
    if (!this.canAcceptCommand()) {
      return false;
    }
    if (this.state.task.state === 'MISSION_STATE_PAUSE') {
      this.log.debug('Already paused; ignoring pause');
      return true;
    }
    return this.publish(DP.PAUSE_COMMAND, { seq: this.nextSeq() });
  }

  resume(): boolean {
    if (!this.canAcceptCommand()) {
      return false;
    }
    return this.publish(DP.RESUME_COMMAND, { seq: this.nextSeq() });
  }

  dock(): boolean {
    if (!this.canAcceptCommand()) {
      return false;
    }

    const { task } = this.state;
    if (RECHARGE_MISSIONS_RUNTIME.has(task.mission) && task.state === 'MISSION_STATE_PAUSE') {
      return this.resume();
    }
    if (RECHARGE_MISSIONS_RUNTIME.has(task.mission) && task.state === 'MISSION_STATE_RUNNING') {
      this.log.debug('Already returning; ignoring dock');
      return true;
    }

    return this.publish(DP.START_COMMAND, {
      seq: this.nextSeq(),
      mode: START_MODE.RETURN,
    });
  }

  private subscribeAll(): void {
    if (!this.client) {
      return;
    }

    const topics = [
      TOPIC.robot(DP.BATTERY_LEVEL),
      TOPIC.robot(DP.TASK_STATUS),
      TOPIC.robot(DP.BATTERY_STATUS),
      TOPIC.robot(DP.CURRENT_OPERATION),
      TOPIC.robot(DP.MAP_STATUS),
      TOPIC.robot(DP.STATISTICS),
      TOPIC.robot(DP.BASE_STATION_TIME),
      TOPIC.robot(DP.BLADE_TIME),
      TOPIC.robot(DP.SCHEDULE),
      TOPIC.robot(DP.COMPATIBILITY),
      TOPIC.MODEL_NAME,
      'data_point/+/robot',
    ];

    for (const topic of topics) {
      this.client.subscribe(topic, { qos: 1 }, (error) => {
        if (error) {
          this.log.warn(`Failed to subscribe to ${topic}: ${error.message}`);
        }
      });
    }
  }

  private requestCompatibilityInfo(): void {
    this.publish(DP.COMPATIBILITY, { seq: this.nextSeq() });
  }

  private handleMessage(topic: string, payload: string): void {
    if (topic === TOPIC.MODEL_NAME) {
      const modelName = payload.trim();
      if (modelName) {
        this.updateState({ modelName });
      }
      return;
    }

    const match = /^data_point\/(\d+)\/robot$/.exec(topic);
    if (!match) {
      return;
    }

    const dpId = Number(match[1]);
    let parsed: unknown;
    try {
      parsed = JSON.parse(payload);
    } catch {
      this.log.warn(`Invalid JSON on ${topic}`);
      return;
    }

    switch (dpId) {
      case DP.BATTERY_LEVEL: {
        const batteryLevel = parseBatteryLevel(parsed);
        if (batteryLevel !== null) {
          this.updateState({ batteryLevel });
        }
        break;
      }
      case DP.BATTERY_STATUS: {
        const batteryStatus = parseBatteryStatus(parsed);
        if (batteryStatus) {
          this.updateState({ batteryStatus });
        }
        break;
      }
      case DP.TASK_STATUS: {
        const task = parseTaskStatus(parsed);
        if (task) {
          this.updateState({ task });
        }
        break;
      }
      case DP.CURRENT_OPERATION: {
        const operation = parseCurrentOperation(parsed);
        if (operation) {
          this.updateState({ operation });
        }
        break;
      }
      case DP.STATISTICS: {
        const statistics = parseStatistics(parsed);
        if (statistics) {
          this.updateState({ statistics });
        }
        break;
      }
      case DP.MAP_STATUS: {
        const mapStatus = parseMapStatus(parsed);
        if (mapStatus) {
          this.updateState({ mapStatus });
        }
        break;
      }
      case DP.SCHEDULE: {
        const schedule = parseSchedule(parsed);
        if (schedule) {
          this.updateState({ schedule });
        }
        break;
      }
      case DP.BLADE_TIME: {
        const bladeMinutes = parseIntValueMinutes(parsed);
        if (bladeMinutes !== null) {
          this.updateState({ bladeMinutes });
        }
        break;
      }
      case DP.BASE_STATION_TIME: {
        const baseStationMinutes = parseIntValueMinutes(parsed);
        if (baseStationMinutes !== null) {
          this.updateState({ baseStationMinutes });
        }
        break;
      }
      default:
        this.log.debug(`Ignoring data point ${dpId}`);
        break;
    }
  }

  private publish(dpId: number, data: Record<string, unknown>): boolean {
    if (!this.client?.connected) {
      this.log.error('Cannot publish: MQTT client is not connected');
      return false;
    }

    const topic = TOPIC.app(dpId);
    const payload = JSON.stringify(data);
    this.log.info(`Publishing to ${topic}: ${payload}`);
    this.client.publish(topic, payload, { qos: 1 });
    this.lastCommandAt = Date.now();
    return true;
  }

  private canAcceptCommand(): boolean {
    const now = Date.now();
    if (now - this.lastCommandAt < this.minCommandIntervalMs) {
      this.log.warn('Command ignored: too soon after previous command');
      return false;
    }
    if (!this.client?.connected) {
      this.log.error('Command ignored: not connected to mower');
      return false;
    }
    return true;
  }

  private nextSeq(): number {
    this.cmdSeq = (this.cmdSeq + 1) >>> 0;
    return this.cmdSeq;
  }

  private updateState(partial: Partial<MowerState>): void {
    const next: MowerState = {
      ...this.state,
      ...partial,
      batteryStatus: partial.batteryStatus
        ? { ...this.state.batteryStatus, ...partial.batteryStatus }
        : this.state.batteryStatus,
      task: partial.task ? { ...this.state.task, ...partial.task } : this.state.task,
      operation: partial.operation
        ? { ...this.state.operation, ...partial.operation }
        : this.state.operation,
      statistics: partial.statistics
        ? { ...this.state.statistics, ...partial.statistics }
        : this.state.statistics,
      mapStatus: partial.mapStatus
        ? { ...this.state.mapStatus, ...partial.mapStatus }
        : this.state.mapStatus,
      schedule: partial.schedule
        ? { ...this.state.schedule, ...partial.schedule }
        : this.state.schedule,
    };
    next.activity = deriveActivity(next.task, next.connected);
    this.state = next;
    this.emit('state', next);
    if (partial.connected !== undefined) {
      this.emit('connected', next.connected);
    }
  }
}

const MOW_MISSIONS_RUNTIME = new Set([
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

const RECHARGE_MISSIONS_RUNTIME = new Set([
  'MISSION_RECHARGE',
  'MISSION_BACK_TO_STARTING_POINT',
]);
