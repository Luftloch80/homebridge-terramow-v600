import type {
  API,
  Characteristic,
  DynamicPlatformPlugin,
  Logging,
  MatterAccessory,
  PlatformAccessory,
  PlatformConfig,
  Service,
} from 'homebridge';

import { TerraMowAccessory } from './accessory.js';
import { TerraMowMatterVacuum } from './matter-vacuum.js';
import { PLATFORM_NAME, PLUGIN_NAME } from './settings.js';
import { TerraMowClient } from './terramow-client.js';
import type { MowerConfig, PlatformPluginConfig } from './types.js';

export class TerraMowV600Platform implements DynamicPlatformPlugin {
  public readonly Service: typeof Service;
  public readonly Characteristic: typeof Characteristic;
  public readonly accessories = new Map<string, PlatformAccessory>();
  private readonly hapHandlers = new Map<string, TerraMowAccessory>();
  private readonly matterVacuums = new Map<string, TerraMowMatterVacuum>();
  private readonly matterAccessories = new Map<string, MatterAccessory>();
  private readonly clients = new Map<string, TerraMowClient>();
  private readonly matterCached = new Map<string, MatterAccessory>();
  private matterEnabled = false;

  constructor(
    public readonly log: Logging,
    public readonly config: PlatformConfig & PlatformPluginConfig,
    public readonly api: API,
  ) {
    this.Service = api.hap.Service;
    this.Characteristic = api.hap.Characteristic;

    this.log.debug('Finished initializing platform:', this.config.name ?? PLATFORM_NAME);

    this.api.on('didFinishLaunching', () => {
      void this.discoverDevices();
    });

    this.api.on('shutdown', () => {
      for (const handler of this.hapHandlers.values()) {
        handler.destroy();
      }
      for (const client of this.clients.values()) {
        client.stop();
      }
      this.hapHandlers.clear();
      this.clients.clear();
      this.matterVacuums.clear();
      this.matterAccessories.clear();
    });
  }

  configureAccessory(accessory: PlatformAccessory): void {
    this.log.info('Loading HAP accessory from cache:', accessory.displayName);
    this.accessories.set(accessory.UUID, accessory);
  }

  configureMatterAccessory(accessory: MatterAccessory): void {
    this.log.info('Loading Matter accessory from cache:', accessory.displayName);
    this.matterCached.set(accessory.UUID, accessory);
  }

  private async discoverDevices(): Promise<void> {
    this.matterEnabled = this.api.isMatterEnabled?.() ?? false;
    if (this.matterEnabled) {
      this.log.info('Matter is enabled — publishing native RoboticVacuumCleaner accessories.');
    } else {
      this.log.warn(
        'Matter is not enabled on this bridge. Apple Home will show a Fan-style accessory. '
          + 'For a native vacuum icon (like Roborock), use Homebridge 2 and enable Matter '
          + 'on this plugin\'s bridge / child bridge, then restart.',
      );
    }

    const mowers = this.resolveMowers();
    if (mowers.length === 0) {
      this.log.warn(
        'No TerraMow mowers configured. Add a mower under platforms → TerraMowV600 → mowers.',
      );
      return;
    }

    const seenHap = new Set<string>();
    const seenMatter: MatterAccessory[] = [];

    for (const mower of mowers) {
      if (!mower.host || !mower.password) {
        this.log.error(`Skipping mower "${mower.name}": host and password are required`);
        continue;
      }

      if (this.matterEnabled && this.api.matter) {
        await this.publishMatterVacuum(mower, seenMatter);
      } else {
        this.publishHapFallback(mower, seenHap);
      }
    }

    // Remove stale HAP accessories
    for (const [uuid, accessory] of this.accessories) {
      if (!seenHap.has(uuid)) {
        this.log.info('Removing HAP accessory from cache:', accessory.displayName);
        this.hapHandlers.get(uuid)?.destroy();
        this.hapHandlers.delete(uuid);
        this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
        this.accessories.delete(uuid);
      }
    }

    // Remove stale Matter accessories
    if (this.matterEnabled && this.api.matter) {
      const keep = new Set(seenMatter.map((a) => a.UUID));
      const stale = [...this.matterCached.values()].filter((a) => !keep.has(a.UUID));
      if (stale.length) {
        this.log.info(`Removing ${stale.length} stale Matter accessor(ies)`);
        await this.api.matter.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, stale);
      }
    }
  }

  private async publishMatterVacuum(
    mower: MowerConfig,
    seenMatter: MatterAccessory[],
  ): Promise<void> {
    const matter = this.api.matter!;
    const client = this.getOrCreateClient(mower);
    const vacuum = new TerraMowMatterVacuum(this.api, this.log, client, mower);
    const accessory = vacuum.accessory;

    const cached = this.matterCached.get(accessory.UUID);
    if (cached) {
      this.log.info('Updating Matter vacuum:', accessory.displayName);
      await matter.updatePlatformAccessories([accessory]);
    } else {
      this.log.info('Adding Matter vacuum:', accessory.displayName);
      await matter.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
    }

    this.matterVacuums.set(accessory.UUID, vacuum);
    this.matterAccessories.set(accessory.UUID, accessory);
    this.matterCached.set(accessory.UUID, accessory);
    seenMatter.push(accessory);

    client.on('state', (state) => {
      void vacuum.applyState(state);
    });
    // Push current state if already connected
    void vacuum.applyState(client.getState());

    // Ensure no HAP twin remains for this mower
    const hapUuid = this.api.hap.uuid.generate(`terramow-v600:${mower.host}`);
    const hapAccessory = this.accessories.get(hapUuid);
    if (hapAccessory) {
      this.log.info('Removing HAP fallback for Matter vacuum:', hapAccessory.displayName);
      this.hapHandlers.get(hapUuid)?.destroy();
      this.hapHandlers.delete(hapUuid);
      this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [hapAccessory]);
      this.accessories.delete(hapUuid);
    }
  }

  private publishHapFallback(mower: MowerConfig, seenHap: Set<string>): void {
    const uuid = this.api.hap.uuid.generate(`terramow-v600:${mower.host}`);
    seenHap.add(uuid);

    const existing = this.accessories.get(uuid);
    if (existing) {
      this.log.info('Restoring HAP fallback accessory:', existing.displayName);
      existing.context.mower = mower;
      existing.displayName = mower.name;
      existing.category = this.api.hap.Categories.FAN;
      this.api.updatePlatformAccessories([existing]);
      this.hapHandlers.set(uuid, new TerraMowAccessory(this, existing, mower));
    } else {
      this.log.info('Adding HAP fallback accessory:', mower.name);
      const accessory = new this.api.platformAccessory(
        mower.name,
        uuid,
        this.api.hap.Categories.FAN,
      );
      accessory.context.mower = mower;
      this.hapHandlers.set(uuid, new TerraMowAccessory(this, accessory, mower));
      this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
      this.accessories.set(uuid, accessory);
    }
  }

  private getOrCreateClient(mower: MowerConfig): TerraMowClient {
    const key = mower.host;
    const existing = this.clients.get(key);
    if (existing) {
      return existing;
    }

    const client = new TerraMowClient({
      host: mower.host,
      password: mower.password,
      port: mower.port,
      logger: {
        info: (message) => this.log.info(`[${mower.name}] ${message}`),
        warn: (message) => this.log.warn(`[${mower.name}] ${message}`),
        error: (message) => this.log.error(`[${mower.name}] ${message}`),
        debug: (message) => this.log.debug(`[${mower.name}] ${message}`),
      },
    });
    client.start();
    this.clients.set(key, client);
    return client;
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
    };
  }
}
