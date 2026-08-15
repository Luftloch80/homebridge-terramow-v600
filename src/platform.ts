import type {
  API,
  Characteristic,
  DynamicPlatformPlugin,
  Logging,
  PlatformAccessory,
  PlatformConfig,
  Service,
} from 'homebridge';

import { TerraMowAccessory } from './accessory.js';
import { PLATFORM_NAME, PLUGIN_NAME } from './settings.js';
import type { MowerConfig, PlatformPluginConfig } from './types.js';

export class TerraMowV600Platform implements DynamicPlatformPlugin {
  public readonly Service: typeof Service;
  public readonly Characteristic: typeof Characteristic;
  public readonly accessories = new Map<string, PlatformAccessory>();
  private readonly handlers = new Map<string, TerraMowAccessory>();

  constructor(
    public readonly log: Logging,
    public readonly config: PlatformConfig & PlatformPluginConfig,
    public readonly api: API,
  ) {
    this.Service = api.hap.Service;
    this.Characteristic = api.hap.Characteristic;

    this.log.debug('Finished initializing platform:', this.config.name ?? PLATFORM_NAME);

    this.api.on('didFinishLaunching', () => {
      this.discoverDevices();
    });

    this.api.on('shutdown', () => {
      for (const handler of this.handlers.values()) {
        handler.destroy();
      }
      this.handlers.clear();
    });
  }

  configureAccessory(accessory: PlatformAccessory): void {
    this.log.info('Loading accessory from cache:', accessory.displayName);
    this.accessories.set(accessory.UUID, accessory);
  }

  discoverDevices(): void {
    const mowers = this.resolveMowers();
    if (mowers.length === 0) {
      this.log.warn(
        'No TerraMow mowers configured. Add a mower under platforms → TerraMowV600 → mowers.',
      );
      return;
    }

    const seen = new Set<string>();

    for (const mower of mowers) {
      if (!mower.host || !mower.password) {
        this.log.error(`Skipping mower "${mower.name}": host and password are required`);
        continue;
      }

      const uuid = this.api.hap.uuid.generate(`terramow-v600:${mower.host}`);
      seen.add(uuid);

      const existing = this.accessories.get(uuid);
      if (existing) {
        this.log.info('Restoring existing accessory from cache:', existing.displayName);
        existing.context.mower = mower;
        existing.displayName = mower.name;
        this.api.updatePlatformAccessories([existing]);
        this.handlers.set(uuid, new TerraMowAccessory(this, existing, mower));
      } else {
        this.log.info('Adding new accessory:', mower.name);
        const accessory = new this.api.platformAccessory(mower.name, uuid);
        accessory.context.mower = mower;
        this.handlers.set(uuid, new TerraMowAccessory(this, accessory, mower));
        this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
        this.accessories.set(uuid, accessory);
      }
    }

    for (const [uuid, accessory] of this.accessories) {
      if (!seen.has(uuid)) {
        this.log.info('Removing accessory from cache:', accessory.displayName);
        this.handlers.get(uuid)?.destroy();
        this.handlers.delete(uuid);
        this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
        this.accessories.delete(uuid);
      }
    }
  }

  private resolveMowers(): MowerConfig[] {
    if (Array.isArray(this.config.mowers) && this.config.mowers.length > 0) {
      return this.config.mowers.map((mower) => this.normalizeMower(mower));
    }

    if (this.config.host && this.config.password) {
      return [
        this.normalizeMower({
          name: this.config.name || 'TerraMow V600',
          host: this.config.host,
          password: this.config.password,
          port: this.config.port,
          lowBatteryThreshold: this.config.lowBatteryThreshold,
          showPauseSwitch: this.config.showPauseSwitch,
          showDockSwitch: this.config.showDockSwitch,
          showSensors: this.config.showSensors,
        }),
      ];
    }

    return [];
  }

  private normalizeMower(mower: MowerConfig): MowerConfig {
    return {
      name: mower.name || 'TerraMow V600',
      host: mower.host.trim(),
      password: mower.password,
      port: mower.port ?? 1883,
      lowBatteryThreshold: mower.lowBatteryThreshold ?? 20,
      showPauseSwitch: mower.showPauseSwitch ?? true,
      showDockSwitch: mower.showDockSwitch ?? true,
      showSensors: mower.showSensors ?? true,
    };
  }
}
