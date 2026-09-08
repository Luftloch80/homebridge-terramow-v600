import type { API, Logger, MatterAccessory } from 'homebridge';

import type { TerraMowClient } from './terramow-client.js';
import { MANUFACTURER } from './matter-vendor.js';
import { isCharging, isFullyCharged } from './state.js';
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

/** Matter OperationalState.ErrorState.NoError */
const ERROR_NO_ERROR = 0;
const ERROR_UNABLE_TO_COMPLETE = 2;

/** Matter PowerSource.Status / BatCharge* */
const POWER = {
  STATUS_ACTIVE: 1,
  STATUS_UNAVAILABLE: 3,
  CHARGE_OK: 0,
  CHARGE_WARNING: 1,
  CHARGE_STATE_UNKNOWN: 0,
  CHARGE_STATE_CHARGING: 1,
  CHARGE_STATE_FULL: 2,
  CHARGE_STATE_NOT_CHARGING: 3,
} as const;

/**
 * Matter RoboticVacuumCleaner accessory — same device type Roborock uses so
 * Apple Home shows the native vacuum icon and controls (requires Homebridge 2
 * with Matter enabled on this plugin's bridge / child bridge).
 *
 * Homebridge publishes RVC as an *external* Matter accessory with its own
 * pairing code (see logs: "Commissioning codes for …").
 */
export class TerraMowMatterVacuum {
  readonly accessory: MatterAccessory;
  private currentOp: number = OP.DOCKED;
  private currentRunMode = RUN_MODE_IDLE;
  private lastFirmware = '';
  private lastModel = '';

  constructor(
    private readonly api: API,
    private readonly log: Logger,
    private readonly client: TerraMowClient,
    private readonly mowerConfig: MowerConfig,
    initialState?: MowerState,
  ) {
    const matter = api.matter;
    if (!matter) {
      throw new Error('Matter API is unavailable');
    }

    const uuid = matter.uuid.generate(`terramow-matter-vacuum:${mowerConfig.host}`);
    const model = initialState?.modelName || 'V600';
    const firmwareRevision = initialState?.firmwareRevision || '0.0.0';
    this.lastFirmware = firmwareRevision;
    this.lastModel = model;

    this.accessory = {
      UUID: uuid,
      displayName: mowerConfig.name,
      deviceType: matter.deviceTypes.RoboticVacuumCleaner,
      serialNumber: mowerConfig.host,
      manufacturer: MANUFACTURER,
      model,
      firmwareRevision,
      hardwareRevision: '1.0.0',
      context: {
        host: mowerConfig.host,
      },
      clusters: {
        // Match Roborock / SharkIQ: do NOT advertise an empty ServiceArea
        // cluster — that can break Matter.js registration / Apple pairing.
        identify: {
          identifyTime: 0,
          identifyType: 3,
        },
        powerSource: {
          status: POWER.STATUS_ACTIVE,
          order: 0,
          description: 'Battery',
          batPresent: true,
          batPercentRemaining: 200,
          batChargeLevel: POWER.CHARGE_OK,
          batChargeState: POWER.CHARGE_STATE_UNKNOWN,
          batFunctionalWhileCharging: true,
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
          // Must include Error (id 3) or Matter.js rolls back registration.
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
          operationalError: { errorStateId: ERROR_NO_ERROR },
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

    const model = state.modelName || 'V600';
    const firmwareRevision = state.firmwareRevision || this.lastFirmware || '0.0.0';
    this.accessory.manufacturer = MANUFACTURER;
    this.accessory.model = model;
    this.accessory.firmwareRevision = firmwareRevision;

    if (firmwareRevision !== this.lastFirmware || model !== this.lastModel) {
      this.lastFirmware = firmwareRevision;
      this.lastModel = model;
      this.log.info(
        `[${this.mowerConfig.name}] Device info: manufacturer=${MANUFACTURER}, model=${model}, firmware=${firmwareRevision}`,
      );
      try {
        await matter.updatePlatformAccessories([this.accessory]);
      } catch (error) {
        this.log.debug(`[${this.mowerConfig.name}] updatePlatformAccessories failed: ${String(error)}`);
      }
    }

    const batPercentRemaining = Math.max(0, Math.min(200, Math.round(state.batteryLevel * 2)));
    const threshold = this.mowerConfig.lowBatteryThreshold ?? 20;
    const batChargeLevel = state.batteryLevel <= threshold ? POWER.CHARGE_WARNING : POWER.CHARGE_OK;
    let batChargeState: number = POWER.CHARGE_STATE_NOT_CHARGING;
    if (!state.connected) {
      batChargeState = POWER.CHARGE_STATE_UNKNOWN;
    } else if (isFullyCharged(state.batteryStatus)) {
      batChargeState = POWER.CHARGE_STATE_FULL;
    } else if (isCharging(state.batteryStatus)) {
      batChargeState = POWER.CHARGE_STATE_CHARGING;
    }

    await matter.updateAccessoryState(this.uuid, 'powerSource', {
      batPercentRemaining,
      batChargeLevel,
      batChargeState,
      status: state.connected ? POWER.STATUS_ACTIVE : POWER.STATUS_UNAVAILABLE,
    });

    const op = this.mapOperationalState(state);
    const runMode = state.activity === 'mowing' || state.activity === 'paused'
      ? RUN_MODE_CLEANING
      : RUN_MODE_IDLE;

    if (op !== this.currentOp) {
      this.currentOp = op;
      const operationalError = op === OP.ERROR
        ? {
            errorStateId: ERROR_UNABLE_TO_COMPLETE,
            errorStateDetails: state.task.hasError ? 'Mower reported a task error' : 'Mower offline or in error',
          }
        : { errorStateId: ERROR_NO_ERROR };
      await matter.updateAccessoryState(this.uuid, 'rvcOperationalState', {
        operationalState: op,
        operationalError,
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
