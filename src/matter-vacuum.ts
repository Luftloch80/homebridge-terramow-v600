import type { API, Logger, MatterAccessory } from 'homebridge';

import type { TerraMowClient } from './terramow-client.js';
import { isCharging } from './state.js';
import type { MowerConfig, MowerState } from './types.js';

const RUN_MODE_IDLE = 0;
const RUN_MODE_CLEANING = 1;

const CLEAN_MODE_VACUUM = 0;

/** Matter RvcOperationalState IDs */
const OP = {
  STOPPED: 0,
  RUNNING: 1,
  PAUSED: 2,
  ERROR: 3,
  SEEKING_CHARGER: 64,
  CHARGING: 65,
  DOCKED: 66,
} as const;

/**
 * Matter RoboticVacuumCleaner accessory — same device type Roborock uses so
 * Apple Home shows the native vacuum icon and controls (requires Homebridge 2
 * with Matter enabled on this plugin's bridge / child bridge).
 */
export class TerraMowMatterVacuum {
  readonly accessory: MatterAccessory;
  private currentOp: number = OP.DOCKED;
  private currentRunMode = RUN_MODE_IDLE;

  constructor(
    private readonly api: API,
    private readonly log: Logger,
    private readonly client: TerraMowClient,
    private readonly mowerConfig: MowerConfig,
  ) {
    const matter = api.matter;
    if (!matter) {
      throw new Error('Matter API is unavailable');
    }

    const uuid = matter.uuid.generate(`terramow-matter-vacuum:${mowerConfig.host}`);

    this.accessory = {
      UUID: uuid,
      displayName: mowerConfig.name,
      deviceType: matter.deviceTypes.RoboticVacuumCleaner,
      serialNumber: mowerConfig.host,
      manufacturer: 'TerraMow',
      model: 'V600',
      firmwareRevision: '1.3.0',
      hardwareRevision: '1.0.0',
      context: {
        host: mowerConfig.host,
      },
      clusters: {
        powerSource: {
          status: 0,
          order: 0,
          description: 'Battery',
          batPercentRemaining: 200,
          batChargeLevel: 0,
          batReplaceability: 1,
        },
        rvcRunMode: {
          supportedModes: [
            {
              label: 'Idle',
              mode: RUN_MODE_IDLE,
              modeTags: [{ value: 16384 }],
            },
            {
              label: 'Cleaning',
              mode: RUN_MODE_CLEANING,
              modeTags: [{ value: 16385 }],
            },
          ],
          currentMode: RUN_MODE_IDLE,
        },
        rvcCleanMode: {
          supportedModes: [
            {
              label: 'Mow',
              mode: CLEAN_MODE_VACUUM,
              modeTags: [{ value: 16385 }],
            },
          ],
          currentMode: CLEAN_MODE_VACUUM,
        },
        rvcOperationalState: {
          operationalStateList: [
            { operationalStateId: OP.STOPPED },
            { operationalStateId: OP.RUNNING },
            { operationalStateId: OP.PAUSED },
            { operationalStateId: OP.ERROR },
            { operationalStateId: OP.SEEKING_CHARGER },
            { operationalStateId: OP.CHARGING },
            { operationalStateId: OP.DOCKED },
          ],
          operationalState: OP.DOCKED,
        },
        serviceArea: {
          supportedAreas: [],
          supportedMaps: [],
          selectedAreas: [],
          currentArea: null,
        },
      },
      handlers: {
        identify: {
          identify: async () => {
            this.log.info(`[${mowerConfig.name}] Identify requested`);
          },
        },
        rvcRunMode: {
          changeToMode: async (request: { newMode: number }) => {
            await this.handleChangeRunMode(request.newMode);
          },
        },
        rvcCleanMode: {
          changeToMode: async () => {
            // Lawn mower only supports mow mode.
          },
        },
        rvcOperationalState: {
          pause: async () => {
            if (!this.client.pause()) {
              throw new matter.status.Failure('Failed to pause');
            }
          },
          resume: async () => {
            if (!this.client.resume()) {
              throw new matter.status.Failure('Failed to resume');
            }
          },
          goHome: async () => {
            if (!this.client.dock()) {
              throw new matter.status.Failure('Failed to return home');
            }
          },
        },
      },
    };
  }

  get uuid(): string {
    return this.accessory.UUID;
  }

  async applyState(state: MowerState): Promise<void> {
    const matter = this.api.matter;
    if (!matter) {
      return;
    }

    this.accessory.model = state.modelName || 'V600';

    const batPercentRemaining = Math.max(0, Math.min(200, Math.round(state.batteryLevel * 2)));
    const batChargeLevel = state.batteryLevel <= (this.mowerConfig.lowBatteryThreshold ?? 20) ? 1 : 0;

    await matter.updateAccessoryState(this.uuid, 'powerSource', {
      batPercentRemaining,
      batChargeLevel,
      status: state.connected ? 0 : 1,
    });

    const op = this.mapOperationalState(state);
    const runMode = state.activity === 'mowing' || state.activity === 'paused'
      ? RUN_MODE_CLEANING
      : RUN_MODE_IDLE;

    if (op !== this.currentOp) {
      this.currentOp = op;
      await matter.updateAccessoryState(this.uuid, 'rvcOperationalState', {
        operationalState: op,
      });
    }

    if (runMode !== this.currentRunMode) {
      this.currentRunMode = runMode;
      await matter.updateAccessoryState(this.uuid, 'rvcRunMode', {
        currentMode: runMode,
      });
    }
  }

  private mapOperationalState(state: MowerState): number {
    if (!state.connected || state.activity === 'error' || state.task.hasError) {
      return OP.ERROR;
    }
    switch (state.activity) {
      case 'mowing':
        return OP.RUNNING;
      case 'paused':
        return OP.PAUSED;
      case 'returning':
        return OP.SEEKING_CHARGER;
      case 'docked':
        return isCharging(state.batteryStatus) ? OP.CHARGING : OP.DOCKED;
      default:
        return OP.STOPPED;
    }
  }

  private async handleChangeRunMode(newMode: number): Promise<void> {
    const matter = this.api.matter!;
    try {
      if (newMode === RUN_MODE_IDLE) {
        this.log.info(`[${this.mowerConfig.name}] Matter: Idle → dock`);
        if (!this.client.dock()) {
          throw new matter.status.Failure('Failed to dock');
        }
        return;
      }
      if (newMode === RUN_MODE_CLEANING) {
        if (this.currentOp === OP.PAUSED) {
          this.log.info(`[${this.mowerConfig.name}] Matter: Cleaning → resume`);
          if (!this.client.resume()) {
            throw new matter.status.Failure('Failed to resume');
          }
        } else {
          this.log.info(`[${this.mowerConfig.name}] Matter: Cleaning → start`);
          if (!this.client.startMowing()) {
            throw new matter.status.Failure('Failed to start mowing');
          }
        }
        return;
      }
      throw new matter.status.InvalidAction(`Run mode ${newMode} not available`);
    } catch (error) {
      if (error && typeof error === 'object' && 'name' in error) {
        throw error;
      }
      this.log.error(`[${this.mowerConfig.name}] Matter run mode failed:`, error);
      throw new matter.status.Failure('Failed to execute command');
    }
  }
}
