import { createRequire } from 'node:module';

import type { Logging } from 'homebridge';

const MANUFACTURER = 'TerraMow';

/**
 * Homebridge hardcodes Matter BasicInformation.vendorName to
 * DEFAULT_BRIDGE_DEFAULTS.vendorName ("Homebridge") for external accessories,
 * ignoring MatterAccessory.manufacturer. Mutate the shared defaults object so
 * Apple Home shows Hersteller = TerraMow for this child-bridge process.
 */
export async function applyTerraMowMatterVendorName(log: Logging): Promise<void> {
  try {
    const require = createRequire(import.meta.url);
    const bridgeServicePath = require.resolve('homebridge/dist/bridgeService.js');
    const bridgeService = await import(bridgeServicePath) as {
      DEFAULT_BRIDGE_DEFAULTS?: { vendorName?: string; manufacturer?: string };
    };
    const defaults = bridgeService.DEFAULT_BRIDGE_DEFAULTS;
    if (!defaults || typeof defaults !== 'object') {
      return;
    }
    if (defaults.vendorName !== MANUFACTURER) {
      defaults.vendorName = MANUFACTURER;
      log.info(`Matter Hersteller/vendorName set to ${MANUFACTURER}`);
    }
    if (defaults.manufacturer && defaults.manufacturer !== MANUFACTURER) {
      defaults.manufacturer = MANUFACTURER;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.debug(`Could not set Matter vendorName to TerraMow: ${message}`);
  }
}

export { MANUFACTURER };
