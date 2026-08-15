import type {
  CharacteristicValue,
  PlatformAccessory,
  Service,
} from 'homebridge';

import type { TerraMowV600Platform } from './platform.js';
import {
  areaToLightLevel,
  baseStationFilterLife,
  bladeFilterLife,
  isAtBase,
  isBatteryTempAbnormal,
  isCharging,
  isMowingActivity,
  isOverheatReturn,
  isRainDelay,
  isWaitingDaylight,
} from './state.js';
import { TerraMowClient } from './terramow-client.js';
import type { MowerConfig, MowerState } from './types.js';

/**
 * Exposes the TerraMow as a HomeKit "vacuum-style" Fanv2 accessory.
 * HomeKit/HAP has no native robot-vacuum service; Fanv2 + sensors is the
 * standard approach used by vacuum plugins.
 */
export class TerraMowAccessory {
  private readonly client: TerraMowClient;
  private readonly vacuumService: Service;
  private readonly batteryService: Service;
  private pauseSwitch?: Service;
  private dockSwitch?: Service;

  private atBaseSensor?: Service;
  private returningSensor?: Service;
  private faultSensor?: Service;
  private rainSensor?: Service;
  private mowingOccupancy?: Service;
  private workingMotion?: Service;
  private chargerContact?: Service;
  private batteryTempContact?: Service;
  private nightDelayContact?: Service;
  private overheatContact?: Service;
  private mapReadyContact?: Service;
  private scheduleContact?: Service;
  private bladeFilter?: Service;
  private baseFilter?: Service;
  private progressLight?: Service;
  private sessionHumidity?: Service;

  private latest: MowerState | null = null;

  constructor(
    private readonly platform: TerraMowV600Platform,
    private readonly accessory: PlatformAccessory,
    private readonly mowerConfig: MowerConfig,
  ) {
    const { Characteristic, Service } = this.platform;

    this.accessory.category = this.platform.api.hap.Categories.FAN;

    this.accessory
      .getService(Service.AccessoryInformation)!
      .setCharacteristic(Characteristic.Manufacturer, 'TerraMow')
      .setCharacteristic(Characteristic.Model, 'V600')
      .setCharacteristic(Characteristic.SerialNumber, this.mowerConfig.host)
      .setCharacteristic(Characteristic.FirmwareRevision, '1.2.0');

    // Remove legacy primary mow switch if upgrading from older versions
    const legacyMow = this.accessory.getServiceById(Service.Switch, 'mow');
    if (legacyMow) {
      this.accessory.removeService(legacyMow);
    }

    this.vacuumService =
      this.accessory.getServiceById(Service.Fanv2, 'vacuum') ||
      this.accessory.addService(Service.Fanv2, this.mowerConfig.name, 'vacuum');
    this.vacuumService.setCharacteristic(Characteristic.Name, this.mowerConfig.name);
    this.vacuumService.setCharacteristic(
      Characteristic.ConfiguredName,
      this.mowerConfig.name,
    );

    this.vacuumService
      .getCharacteristic(Characteristic.Active)
      .onGet(() => this.getVacuumActive())
      .onSet((value) => this.handleVacuumActiveSet(value));

    this.vacuumService
      .getCharacteristic(Characteristic.CurrentFanState)
      .onGet(() => this.getCurrentFanState());

    this.vacuumService
      .getCharacteristic(Characteristic.TargetFanState)
      .onGet(() => this.platform.Characteristic.TargetFanState.AUTO)
      .onSet(() => undefined);

    this.vacuumService
      .getCharacteristic(Characteristic.RotationSpeed)
      .onGet(() => this.latest?.operation.progressPercent ?? 0)
      .onSet(async (value) => {
        // Speed is progress readout; 0 docks, any other value starts/resumes.
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
      this.removeById(Service.Switch, 'pause');
    }

    if (this.mowerConfig.showDockSwitch !== false) {
      this.dockSwitch =
        this.accessory.getServiceById(Service.Switch, 'dock') ||
        this.accessory.addService(
          Service.Switch,
          `${this.mowerConfig.name} Return Home`,
          'dock',
        );
      this.dockSwitch.setCharacteristic(
        Characteristic.Name,
        `${this.mowerConfig.name} Return Home`,
      );
      this.dockSwitch
        .getCharacteristic(Characteristic.On)
        .onGet(() => this.latest?.activity === 'returning')
        .onSet((value) => this.handleDockSet(value));
    } else {
      this.removeById(Service.Switch, 'dock');
    }

    if (this.mowerConfig.showSensors !== false) {
      this.atBaseSensor = this.contact('At Base', 'at-base');
      this.returningSensor = this.contact('Returning', 'returning');
      this.faultSensor = this.contact('Fault', 'fault');
      this.rainSensor = this.leak('Rain Delay', 'rain-delay');
      this.mowingOccupancy = this.occupancy('Mowing', 'mowing');
      this.workingMotion = this.motion('Working', 'working');
      this.chargerContact = this.contact('Charger Connected', 'charger');
      this.batteryTempContact = this.contact('Battery Temp Alert', 'batt-temp');
      this.nightDelayContact = this.contact('Night Delay', 'night-delay');
      this.overheatContact = this.contact('Motor Overheat', 'overheat');
      this.mapReadyContact = this.contact('Map Ready', 'map-ready');
      this.scheduleContact = this.contact('Schedule Upcoming', 'schedule');
      this.bladeFilter = this.filter('Blade Wear', 'blade-filter');
      this.baseFilter = this.filter('Base Station Wear', 'base-filter');
      this.progressLight = this.lightSensor('Cleaned Area', 'cleaned-area');
      this.sessionHumidity = this.humidity('Job Progress', 'job-progress');
    } else {
      for (const [service, subtype] of [
        [Service.ContactSensor, 'at-base'],
        [Service.ContactSensor, 'returning'],
        [Service.ContactSensor, 'fault'],
        [Service.LeakSensor, 'rain-delay'],
        [Service.OccupancySensor, 'mowing'],
        [Service.MotionSensor, 'working'],
        [Service.ContactSensor, 'charger'],
        [Service.ContactSensor, 'batt-temp'],
        [Service.ContactSensor, 'night-delay'],
        [Service.ContactSensor, 'overheat'],
        [Service.ContactSensor, 'map-ready'],
        [Service.ContactSensor, 'schedule'],
        [Service.FilterMaintenance, 'blade-filter'],
        [Service.FilterMaintenance, 'base-filter'],
        [Service.LightSensor, 'cleaned-area'],
        [Service.HumiditySensor, 'job-progress'],
      ] as const) {
        this.removeById(service, subtype);
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

  private removeById(service: typeof this.platform.Service.Switch, subtype: string): void {
    const existing = this.accessory.getServiceById(service, subtype);
    if (existing) {
      this.accessory.removeService(existing);
    }
  }

  private contact(label: string, subtype: string): Service {
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

  private leak(label: string, subtype: string): Service {
    const { Characteristic, Service } = this.platform;
    const service =
      this.accessory.getServiceById(Service.LeakSensor, subtype) ||
      this.accessory.addService(
        Service.LeakSensor,
        `${this.mowerConfig.name} ${label}`,
        subtype,
      );
    service.setCharacteristic(Characteristic.Name, `${this.mowerConfig.name} ${label}`);
    return service;
  }

  private occupancy(label: string, subtype: string): Service {
    const { Characteristic, Service } = this.platform;
    const service =
      this.accessory.getServiceById(Service.OccupancySensor, subtype) ||
      this.accessory.addService(
        Service.OccupancySensor,
        `${this.mowerConfig.name} ${label}`,
        subtype,
      );
    service.setCharacteristic(Characteristic.Name, `${this.mowerConfig.name} ${label}`);
    return service;
  }

  private motion(label: string, subtype: string): Service {
    const { Characteristic, Service } = this.platform;
    const service =
      this.accessory.getServiceById(Service.MotionSensor, subtype) ||
      this.accessory.addService(
        Service.MotionSensor,
        `${this.mowerConfig.name} ${label}`,
        subtype,
      );
    service.setCharacteristic(Characteristic.Name, `${this.mowerConfig.name} ${label}`);
    return service;
  }

  private filter(label: string, subtype: string): Service {
    const { Characteristic, Service } = this.platform;
    const service =
      this.accessory.getServiceById(Service.FilterMaintenance, subtype) ||
      this.accessory.addService(
        Service.FilterMaintenance,
        `${this.mowerConfig.name} ${label}`,
        subtype,
      );
    service.setCharacteristic(Characteristic.Name, `${this.mowerConfig.name} ${label}`);
    return service;
  }

  private lightSensor(label: string, subtype: string): Service {
    const { Characteristic, Service } = this.platform;
    const service =
      this.accessory.getServiceById(Service.LightSensor, subtype) ||
      this.accessory.addService(
        Service.LightSensor,
        `${this.mowerConfig.name} ${label}`,
        subtype,
      );
    service.setCharacteristic(Characteristic.Name, `${this.mowerConfig.name} ${label}`);
    return service;
  }

  private humidity(label: string, subtype: string): Service {
    const { Characteristic, Service } = this.platform;
    const service =
      this.accessory.getServiceById(Service.HumiditySensor, subtype) ||
      this.accessory.addService(
        Service.HumiditySensor,
        `${this.mowerConfig.name} ${label}`,
        subtype,
      );
    service.setCharacteristic(Characteristic.Name, `${this.mowerConfig.name} ${label}`);
    return service;
  }

  private applyState(state: MowerState): void {
    this.latest = state;
    const { Characteristic } = this.platform;
    const detected = Characteristic.ContactSensorState.CONTACT_DETECTED;
    const notDetected = Characteristic.ContactSensorState.CONTACT_NOT_DETECTED;

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

    this.pauseSwitch?.updateCharacteristic(Characteristic.On, state.activity === 'paused');
    this.dockSwitch?.updateCharacteristic(Characteristic.On, state.activity === 'returning');

    this.atBaseSensor?.updateCharacteristic(
      Characteristic.ContactSensorState,
      isAtBase(state.activity, state.batteryStatus) ? detected : notDetected,
    );
    this.returningSensor?.updateCharacteristic(
      Characteristic.ContactSensorState,
      state.activity === 'returning' ? detected : notDetected,
    );
    this.faultSensor?.updateCharacteristic(
      Characteristic.ContactSensorState,
      state.activity === 'error' || state.task.hasError || !state.connected
        ? detected
        : notDetected,
    );
    this.rainSensor?.updateCharacteristic(
      Characteristic.LeakDetected,
      isRainDelay(state.task)
        ? Characteristic.LeakDetected.LEAK_DETECTED
        : Characteristic.LeakDetected.LEAK_NOT_DETECTED,
    );
    this.mowingOccupancy?.updateCharacteristic(
      Characteristic.OccupancyDetected,
      state.activity === 'mowing'
        ? Characteristic.OccupancyDetected.OCCUPANCY_DETECTED
        : Characteristic.OccupancyDetected.OCCUPANCY_NOT_DETECTED,
    );
    this.workingMotion?.updateCharacteristic(
      Characteristic.MotionDetected,
      state.activity === 'mowing' || state.activity === 'returning',
    );
    this.chargerContact?.updateCharacteristic(
      Characteristic.ContactSensorState,
      state.batteryStatus.chargerConnected ? detected : notDetected,
    );
    this.batteryTempContact?.updateCharacteristic(
      Characteristic.ContactSensorState,
      isBatteryTempAbnormal(state.batteryStatus) ? detected : notDetected,
    );
    this.nightDelayContact?.updateCharacteristic(
      Characteristic.ContactSensorState,
      isWaitingDaylight(state.task) ? detected : notDetected,
    );
    this.overheatContact?.updateCharacteristic(
      Characteristic.ContactSensorState,
      isOverheatReturn(state.task) ? detected : notDetected,
    );
    this.mapReadyContact?.updateCharacteristic(
      Characteristic.ContactSensorState,
      state.mapStatus.mapDetected && state.mapStatus.mapState === 'MAP_STATE_COMPLETE'
        ? detected
        : notDetected,
    );
    this.scheduleContact?.updateCharacteristic(
      Characteristic.ContactSensorState,
      state.schedule.exist ? detected : notDetected,
    );

    const bladeLife = bladeFilterLife(state.bladeMinutes);
    this.bladeFilter?.updateCharacteristic(Characteristic.FilterLifeLevel, bladeLife);
    this.bladeFilter?.updateCharacteristic(
      Characteristic.FilterChangeIndication,
      bladeLife <= 10
        ? Characteristic.FilterChangeIndication.CHANGE_FILTER
        : Characteristic.FilterChangeIndication.FILTER_OK,
    );

    const baseLife = baseStationFilterLife(state.baseStationMinutes);
    this.baseFilter?.updateCharacteristic(Characteristic.FilterLifeLevel, baseLife);
    this.baseFilter?.updateCharacteristic(
      Characteristic.FilterChangeIndication,
      baseLife <= 10
        ? Characteristic.FilterChangeIndication.CHANGE_FILTER
        : Characteristic.FilterChangeIndication.FILTER_OK,
    );

    this.progressLight?.updateCharacteristic(
      Characteristic.CurrentAmbientLightLevel,
      areaToLightLevel(state.operation.cleanArea || state.statistics.cleanArea),
    );
    this.sessionHumidity?.updateCharacteristic(
      Characteristic.CurrentRelativeHumidity,
      state.operation.progressPercent,
    );
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

  private failComm(): never {
    throw new this.platform.api.hap.HapStatusError(
      this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE,
    );
  }

  private async handleVacuumActiveSet(value: CharacteristicValue): Promise<void> {
    const on = Number(value) === this.platform.Characteristic.Active.ACTIVE;
    const ok = on ? this.client.startMowing() : this.client.dock();
    if (!ok) {
      this.failComm();
    }
  }

  private async handlePauseSet(value: CharacteristicValue): Promise<void> {
    const on = Boolean(value);
    const ok = on ? this.client.pause() : this.client.resume();
    if (!ok) {
      this.failComm();
    }
  }

  private async handleDockSet(value: CharacteristicValue): Promise<void> {
    if (!value) {
      if (this.latest?.activity === 'returning') {
        const ok = this.client.resume();
        if (!ok) {
          this.failComm();
        }
      }
      return;
    }

    const ok = this.client.dock();
    if (!ok) {
      this.failComm();
    }
  }
}
