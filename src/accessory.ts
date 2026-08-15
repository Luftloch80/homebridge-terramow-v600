import type {
  CharacteristicValue,
  PlatformAccessory,
  Service,
} from 'homebridge';

import type { TerraMowV600Platform } from './platform.js';
import { isAtBase, isCharging, isMowingActivity, isRainDelay } from './state.js';
import { TerraMowClient } from './terramow-client.js';
import type { MowerConfig, MowerState } from './types.js';

export class TerraMowAccessory {
  private readonly client: TerraMowClient;
  private readonly mowSwitch: Service;
  private readonly batteryService: Service;
  private pauseSwitch?: Service;
  private dockSwitch?: Service;
  private atBaseSensor?: Service;
  private returningSensor?: Service;
  private faultSensor?: Service;
  private rainSensor?: Service;
  private latest: MowerState | null = null;

  constructor(
    private readonly platform: TerraMowV600Platform,
    private readonly accessory: PlatformAccessory,
    private readonly mowerConfig: MowerConfig,
  ) {
    const { Characteristic, Service } = this.platform;

    this.accessory
      .getService(Service.AccessoryInformation)!
      .setCharacteristic(Characteristic.Manufacturer, 'TerraMow')
      .setCharacteristic(Characteristic.Model, 'V600')
      .setCharacteristic(Characteristic.SerialNumber, this.mowerConfig.host)
      .setCharacteristic(Characteristic.FirmwareRevision, '1.0.0');

    this.mowSwitch =
      this.accessory.getServiceById(Service.Switch, 'mow') ||
      this.accessory.addService(Service.Switch, `${this.mowerConfig.name} Mow`, 'mow');
    this.mowSwitch.setCharacteristic(Characteristic.Name, `${this.mowerConfig.name} Mow`);
    this.mowSwitch
      .getCharacteristic(Characteristic.On)
      .onGet(() => this.isMowOn())
      .onSet((value) => this.handleMowSet(value));

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

    if (this.mowerConfig.showPauseSwitch !== false) {
      this.pauseSwitch =
        this.accessory.getServiceById(Service.Switch, 'pause') ||
        this.accessory.addService(Service.Switch, `${this.mowerConfig.name} Pause`, 'pause');
      this.pauseSwitch.setCharacteristic(Characteristic.Name, `${this.mowerConfig.name} Pause`);
      this.pauseSwitch
        .getCharacteristic(Characteristic.On)
        .onGet(() => this.latest?.activity === 'paused')
        .onSet((value) => this.handlePauseSet(value));
    } else {
      const existing = this.accessory.getServiceById(Service.Switch, 'pause');
      if (existing) {
        this.accessory.removeService(existing);
      }
    }

    if (this.mowerConfig.showDockSwitch !== false) {
      this.dockSwitch =
        this.accessory.getServiceById(Service.Switch, 'dock') ||
        this.accessory.addService(Service.Switch, `${this.mowerConfig.name} Dock`, 'dock');
      this.dockSwitch.setCharacteristic(Characteristic.Name, `${this.mowerConfig.name} Dock`);
      this.dockSwitch
        .getCharacteristic(Characteristic.On)
        .onGet(() => this.latest?.activity === 'returning')
        .onSet((value) => this.handleDockSet(value));
    } else {
      const existing = this.accessory.getServiceById(Service.Switch, 'dock');
      if (existing) {
        this.accessory.removeService(existing);
      }
    }

    if (this.mowerConfig.showSensors !== false) {
      this.atBaseSensor = this.getOrCreateContact('At Base', 'at-base');
      this.returningSensor = this.getOrCreateContact('Returning', 'returning');
      this.faultSensor = this.getOrCreateContact('Fault', 'fault');
      this.rainSensor = this.getOrCreateContact('Rain Delay', 'rain-delay');
    } else {
      for (const subtype of ['at-base', 'returning', 'fault', 'rain-delay']) {
        const existing = this.accessory.getServiceById(Service.ContactSensor, subtype);
        if (existing) {
          this.accessory.removeService(existing);
        }
      }
    }

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

  destroy(): void {
    this.client.stop();
  }

  private getOrCreateContact(label: string, subtype: string): Service {
    const { Characteristic, Service } = this.platform;
    const service =
      this.accessory.getServiceById(Service.ContactSensor, subtype) ||
      this.accessory.addService(
        Service.ContactSensor,
        `${this.mowerConfig.name} ${label}`,
        subtype,
      );
    service.setCharacteristic(Characteristic.Name, `${this.mowerConfig.name} ${label}`);
    return service;
  }

  private applyState(state: MowerState): void {
    this.latest = state;
    const { Characteristic } = this.platform;

    this.accessory
      .getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(Characteristic.Model, state.modelName || 'V600');

    this.mowSwitch.updateCharacteristic(Characteristic.On, this.isMowOn());
    this.batteryService.updateCharacteristic(Characteristic.BatteryLevel, state.batteryLevel);
    this.batteryService.updateCharacteristic(Characteristic.StatusLowBattery, this.getLowBattery());
    this.batteryService.updateCharacteristic(Characteristic.ChargingState, this.getChargingState());

    this.pauseSwitch?.updateCharacteristic(Characteristic.On, state.activity === 'paused');
    this.dockSwitch?.updateCharacteristic(Characteristic.On, state.activity === 'returning');

    const contactDetected = this.platform.Characteristic.ContactSensorState.CONTACT_DETECTED;
    const contactNotDetected = this.platform.Characteristic.ContactSensorState.CONTACT_NOT_DETECTED;

    this.atBaseSensor?.updateCharacteristic(
      Characteristic.ContactSensorState,
      isAtBase(state.activity, state.batteryStatus) ? contactDetected : contactNotDetected,
    );
    this.returningSensor?.updateCharacteristic(
      Characteristic.ContactSensorState,
      state.activity === 'returning' ? contactDetected : contactNotDetected,
    );
    this.faultSensor?.updateCharacteristic(
      Characteristic.ContactSensorState,
      state.activity === 'error' || state.task.hasError
        ? contactDetected
        : contactNotDetected,
    );
    this.rainSensor?.updateCharacteristic(
      Characteristic.ContactSensorState,
      isRainDelay(state.task) ? contactDetected : contactNotDetected,
    );
  }

  private isMowOn(): boolean {
    return isMowingActivity(this.latest?.activity ?? 'unknown');
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

  private async handleMowSet(value: CharacteristicValue): Promise<void> {
    const on = Boolean(value);
    if (on) {
      const ok = this.client.startMowing();
      if (!ok) {
        throw new this.platform.api.hap.HapStatusError(
          this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE,
        );
      }
      return;
    }

    const ok = this.client.dock();
    if (!ok) {
      throw new this.platform.api.hap.HapStatusError(
        this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE,
      );
    }
  }

  private async handlePauseSet(value: CharacteristicValue): Promise<void> {
    const on = Boolean(value);
    const ok = on ? this.client.pause() : this.client.resume();
    if (!ok) {
      throw new this.platform.api.hap.HapStatusError(
        this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE,
      );
    }
  }

  private async handleDockSet(value: CharacteristicValue): Promise<void> {
    if (!value) {
      // Turning dock off while returning is treated as resume/start mowing.
      if (this.latest?.activity === 'returning') {
        const ok = this.client.resume();
        if (!ok) {
          throw new this.platform.api.hap.HapStatusError(
            this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE,
          );
        }
      }
      return;
    }

    const ok = this.client.dock();
    if (!ok) {
      throw new this.platform.api.hap.HapStatusError(
        this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE,
      );
    }
  }
}
