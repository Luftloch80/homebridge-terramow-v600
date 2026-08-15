# homebridge-terramow-v600

Homebridge plugin for the **TerraMow V600** (and other TerraMow models with the local MQTT Home Assistant interface).

The mower runs an on-device MQTT broker. This plugin connects over your LAN — no cloud account required.

## Native vacuum in Apple Home (like Roborock)

Apple Home only shows the real **robot vacuum** icon and UI via **Matter** (not classic HomeKit/HAP). This plugin follows the same approach as Roborock Matter plugins:

1. Use **Homebridge 2**
2. Run this plugin in a **child bridge**
3. Enable **Matter** on that child bridge
4. Restart, then add the Matter bridge / vacuum in Apple Home with the pairing code from Homebridge

You get start/stop cleaning, pause, resume, return home, and battery on one vacuum tile — **no extra sensors**.

If Matter is not enabled, the plugin falls back to a simple Fanv2 HAP accessory (no sensors) and logs a warning.

## Requirements

- Homebridge **2.x** recommended (Matter for native vacuum UI)
- TerraMow firmware **6.6.0+** and app **1.6.0+**
- Home Assistant integration enabled in the TerraMow app (MQTT password)

## Install

### Homebridge UI

1. **Plugins** → search `homebridge-terramow-v600` / **TerraMow V600**
2. Install → open **Settings** → enter IP + MQTT password → **Save**
3. Prefer a **child bridge**, enable **Matter** on it, restart
4. Pair the Matter vacuum in Apple Home

### Command line

```bash
npm install -g homebridge-terramow-v600
```

## Configuration

```json
{
  "platforms": [
    {
      "platform": "TerraMowV600",
      "name": "TerraMow",
      "mowers": [
        {
          "name": "Front Lawn",
          "host": "192.168.1.50",
          "password": "YOUR_MQTT_PASSWORD",
          "port": 1883,
          "lowBatteryThreshold": 20
        }
      ]
    }
  ]
}
```

MQTT username is fixed by TerraMow as `terramow`.

## Controls (Matter vacuum)

| Action | Behavior |
| --- | --- |
| Start cleaning | Global mow |
| Idle / stop | Return to dock |
| Pause / Resume | Pause or continue |
| Return home | Dock |
| Battery | Level + charging |

## Protocol notes

Uses the same local MQTT data points as the official TerraMow Home Assistant integration:

| Direction | Topic | Purpose |
| --- | --- | --- |
| Robot → plugin | `data_point/{id}/robot` | Status |
| Plugin → robot | `data_point/{id}/app` | Commands |

Commands: start DP `103` `START_MODE_GLOBAL_CLEAN`, pause `105`, resume `106`, dock `103` `START_MODE_RETURN`.

## Homebridge UI

Custom settings page with MQTT **Test Connection**.

## Development

```bash
npm install
npm run build
npm test
```

## License

Apache-2.0
