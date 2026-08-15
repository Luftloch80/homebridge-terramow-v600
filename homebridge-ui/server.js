import mqtt from 'mqtt';

import { HomebridgePluginUiServer, RequestError } from '@homebridge/plugin-ui-utils';

const MQTT_USERNAME = 'terramow';
const DEFAULT_PORT = 1883;
const CONNECT_TIMEOUT_MS = 8000;

class TerraMowPluginUiServer extends HomebridgePluginUiServer {
  constructor() {
    super();
    this.onRequest('/test-connection', this.testConnection.bind(this));
    this.ready();
  }

  /**
   * Probe the TerraMow on-device MQTT broker.
   * @param {{ host?: string, password?: string, port?: number }} payload
   */
  async testConnection(payload = {}) {
    const host = typeof payload.host === 'string' ? payload.host.trim() : '';
    const password = typeof payload.password === 'string' ? payload.password : '';
    const port = Number(payload.port) || DEFAULT_PORT;

    if (!host) {
      throw new RequestError('Missing host', { message: 'Enter the mower IP address or hostname.' });
    }
    if (!password) {
      throw new RequestError('Missing password', {
        message: 'Enter the MQTT password from the TerraMow app.',
      });
    }

    const url = `mqtt://${host}:${port}`;

    try {
      await new Promise((resolve, reject) => {
        const client = mqtt.connect(url, {
          username: MQTT_USERNAME,
          password,
          connectTimeout: CONNECT_TIMEOUT_MS,
          reconnectPeriod: 0,
          clean: true,
          clientId: `hb-ui-terramow-${Math.random().toString(16).slice(2, 8)}`,
        });

        const timer = setTimeout(() => {
          client.end(true);
          reject(new Error(`Timed out connecting to ${url}`));
        }, CONNECT_TIMEOUT_MS + 1000);

        client.on('connect', () => {
          clearTimeout(timer);
          client.end(true);
          resolve();
        });

        client.on('error', (error) => {
          clearTimeout(timer);
          client.end(true);
          reject(error);
        });
      });

      return {
        ok: true,
        message: `Connected to ${host}:${port} as ${MQTT_USERNAME}.`,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new RequestError('Connection failed', { message });
    }
  }
}

(() => new TerraMowPluginUiServer())();
