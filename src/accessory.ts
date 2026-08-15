import type {
  CharacteristicValue,
  PlatformAccessory,
  Service,
} from 'homebridge';

import type { TerraMowV600Platform } from './platform.js';
import { isCharging, isMowingActivity } from './state.js';
import { TerraMowClient } from './terramow-client.js';
import type { MowerConfig, MowerState } from './types.js';

/**
 * HAP fallback when Matter is unavailable (Homebridge 1.x or Matter disabled).
 * Fanv2 only — no extra sensors. Prefer Matter RoboticVacuumCleaner for the
 * native vacuum tile in Apple Home.
 */
export class TerraMowAccessory {
  private readonly client: TerraMowClient;
  private readonly vacuumService: Service;
  private readonly batteryService: Service;
  private latest: MowerState | null = null;

  constructor(
    private readonly platform: TerraMowV600Platform,
    private readonly accessory: PlatformAccessory,
    private readonly mowerConfig: MowerConfig,
  ) {
    const { Characteristic, Service } = this.platform;

    this.accessory.category = this.platform.api.hap.Categories.FAN;
    this.stripLegacyServices();

    this.accessory
      .getService(Service.AccessoryInformation)!
      .setCharacteristic(Characteristic.Manufacturer, 'TerraMow')
      .setCharacteristic(Characteristic.Model, 'V600')
      .setCharacteristic(Characteristic.SerialNumber, this.mowerConfig.host)
      .setCharacteristic(Characteristic.FirmwareRevision, '1.3.0');

    this.vacuumService =
      this.accessory.getServiceById(Service.Fanv2, 'vacuum') ||
      this.accessory.addService(Service.Fanv2, this.mowerConfig.name, 'vacuum');
    this.vacuumService.setCharacteristic(Characteristic.Name, this.mowerConfig.name);

    this.vacuumService
      .getCharacteristic(Characteristic.Active)
      .onGet(() => this.getVacuumActive())
      .onSet((value) => this.handleVacuumActiveSet(value));

    this.vacuumService
      .getCharacteristic(Characteristic.CurrentFanState)
      .onGet(() => this.getCurrentFanState());

    this.vacuumService
      .getCharacteristic(Characteristic.RotationSpeed)
      .onGet(() => this.latest?.operation.progressPercent ?? 0)
      .onSet(async (value) => {
        if (Number(value) <= 0) {
          await this.handleVacuumActiveSet(Characteristic.Active.INACTIVE);
        } else {
          await this.handleVacuumActiveSet(Characteristic.Active.ACTIVE);
        }
      });

    this.batteryService =
      this.accessory.getService(Service.Battery) ||
      this.accessory.addService(Service.Battery, `${this.mowerConfig.name} Battery`);
    this.batteryService
      .getCharacteristic(Characteristic.BatteryLevel)
      .onGet(() => this.latest?.batteryLevel ?? 100);
    this.batteryService
      .getCharacteristic(Characteristic.StatusLowBattery)
      .onGet(() => this.getLowBattery());
    this.batteryService
      .getCharacteristic(Characteristic.ChargingState)
      .onGet(() => this.getChargingState());

    this.client = new TerraMowClient({
      host: this.mowerConfig.host,
      password: this.mowerConfig.password,
      port: this.mowerConfig.port,
      logger: {
        info: (message) => this.platform.log.info(`[${this.mowerConfig.name}] ${message}`),
        warn: (message) => this.platform.log.warn(`[${this.mowerConfig.name}] ${message}`),
        error: (message) => this.platform.log.error(`[${this.mowerConfig.name}] ${message}`),
        debug: (message) => this.platform.log.debug(`[${this.mowerConfig.name}] ${message}`),
      },
    });

    this.client.on('state', (state) => this.applyState(state));
    this.client.start();
  }

  /** Expose client so platform can share one MQTT session with Matter. */
  getClient(): TerraMowClient {
    return this.client;
  }

  destroy(): void {
    this.client.stop();
  }

  private stripLegacyServices(): void {
    const { Service } = this.platform;
    const remove = (
      service: typeof Service.Switch,
      subtype: string,
    ): void => {
      const existing = this.accessory.getServiceById(service, subtype);
      if (existing) {
        this.accessory.removeService(existing);
      }
    };

    remove(Service.Switch, 'mow');
    remove(Service.Switch, 'pause');
    remove(Service.Switch, 'dock');

    for (const subtype of [
      'at-base',
      'returning',
      'fault',
      'charger',
      'batt-temp',
      'night-delay',
      'overheat',
      'map-ready',
      'schedule',
    ]) {
      remove(Service.ContactSensor, subtype);
    }
    remove(Service.LeakSensor, 'rain-delay');
    remove(Service.OccupancySensor, 'mowing');
    remove(Service.MotionSensor, 'working');
    remove(Service.FilterMaintenance, 'blade-filter');
    remove(Service.FilterMaintenance, 'base-filter');
    remove(Service.LightSensor, 'cleaned-area');
    remove(Service.HumiditySensor, 'job-progress');
  }

  private applyState(state: MowerState): void {
    this.latest = state;
    const { Characteristic } = this.platform;

    this.accessory
      .getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(Characteristic.Model, state.modelName || 'V600');

    this.vacuumService.updateCharacteristic(Characteristic.Active, this.getVacuumActive());
    this.vacuumService.updateCharacteristic(
      Characteristic.CurrentFanState,
      this.getCurrentFanState(),
    );
    this.vacuumService.updateCharacteristic(
      Characteristic.RotationSpeed,
      state.operation.progressPercent,
    );

    this.batteryService.updateCharacteristic(Characteristic.BatteryLevel, state.batteryLevel);
    this.batteryService.updateCharacteristic(Characteristic.StatusLowBattery, this.getLowBattery());
    this.batteryService.updateCharacteristic(Characteristic.ChargingState, this.getChargingState());
  }

  private getVacuumActive(): CharacteristicValue {
    return isMowingActivity(this.latest?.activity ?? 'unknown')
      ? this.platform.Characteristic.Active.ACTIVE
      : this.platform.Characteristic.Active.INACTIVE;
  }

  private getCurrentFanState(): CharacteristicValue {
    const { Characteristic } = this.platform;
    switch (this.latest?.activity) {
      case 'mowing':
        return Characteristic.CurrentFanState.BLOWING_AIR;
      case 'paused':
      case 'returning':
        return Characteristic.CurrentFanState.IDLE;
      default:
        return Characteristic.CurrentFanState.INACTIVE;
    }
  }

  private getLowBattery(): CharacteristicValue {
    const threshold = this.mowerConfig.lowBatteryThreshold ?? 20;
    const level = this.latest?.batteryLevel ?? 100;
    return level <= threshold
      ? this.platform.Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW
      : this.platform.Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL;
  }

  private getChargingState(): CharacteristicValue {
    if (!this.latest) {
      return this.platform.Characteristic.ChargingState.NOT_CHARGING;
    }
    return isCharging(this.latest.batteryStatus)
      ? this.platform.Characteristic.ChargingState.CHARGING
      : this.platform.Characteristic.ChargingState.NOT_CHARGING;
  }

  private async handleVacuumActiveSet(value: CharacteristicValue): Promise<void> {
    const on = Number(value) === this.platform.Characteristic.Active.ACTIVE;
    const ok = on ? this.client.startMowing() : this.client.dock();
    if (!ok) {
      throw new this.platform.api.hap.HapStatusError(
        this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE,
      );
    }
  }
}
