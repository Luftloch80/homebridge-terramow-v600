# homebridge-terramow-v600

Homebridge plugin for the **TerraMow V600** (and other TerraMow models that expose the local Home Assistant MQTT interface).

The mower runs an on-device MQTT broker. This plugin connects over your LAN — no cloud account required.

## Requirements

- Homebridge 1.8+ / 2.x
- TerraMow firmware **6.6.0+** and app **1.6.0+**
- Home Assistant integration enabled in the TerraMow app (this turns on the MQTT broker and shows the password)

## Install

### Homebridge UI (recommended)

1. Open **Plugins**
2. Search for **TerraMow V600**, or use **Install from GitHub / npm**:
   - npm: `homebridge-terramow-v600` (when published)
   - GitHub: `Luftloch80/homebridge-terramow-v600`
3. Open the plugin **Settings** — the Homebridge UI form includes an MQTT **Test Connection** button
4. Save and restart Homebridge

### Command line

```bash
npm install -g homebridge-terramow-v600
# or directly from GitHub:
npm install -g github:Luftloch80/homebridge-terramow-v600
```

## Configuration

In the TerraMow app: enable Home Assistant integration, then copy the MQTT password and mower IP.

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
          "lowBatteryThreshold": 20,
          "showPauseSwitch": true,
          "showDockSwitch": true,
          "showSensors": true
        }
      ]
    }
  ]
}
```

MQTT username is fixed by TerraMow as `terramow` (you do not configure it).

### Legacy single-mower config

```json
{
  "platform": "TerraMowV600",
  "name": "TerraMow V600",
  "host": "192.168.1.50",
  "password": "YOUR_MQTT_PASSWORD"
}
```

## HomeKit controls

| Service | Behavior |
| --- | --- |
| **Mow** switch | On = start / resume mowing. Off = return to dock. |
| **Pause** switch | On = pause. Off = resume. |
| **Dock** switch | On = return to base. Off while returning = resume. |
| **Battery** | Level, charging state, low-battery status. |
| **At Base** contact | Detected when docked or charger connected. |
| **Returning** contact | Detected while heading home. |
| **Fault** contact | Detected on error / disconnect. |
| **Rain Delay** contact | Detected when rain caused a return. |

## Protocol notes

Uses the same local MQTT data points as the official TerraMow Home Assistant integration:

| Direction | Topic | Purpose |
| --- | --- | --- |
| Robot → plugin | `data_point/{id}/robot` | Status (battery, mission, …) |
| Plugin → robot | `data_point/{id}/app` | Commands |
| Robot → plugin | `model/name` | Commercial model string |

Commands:

- Start mow → DP `103` `{ "mode": "START_MODE_GLOBAL_CLEAN", "global_clean": { "restart": false } }`
- Pause → DP `105`
- Resume → DP `106`
- Dock → DP `103` `{ "mode": "START_MODE_RETURN" }`

## Homebridge UI

This plugin ships a Config UI X / Homebridge UI settings page (`homebridge-ui/`) with:

- Setup instructions
- MQTT **Test Connection** against the mower’s on-device broker
- The standard schema form for platform + mower options (`customUi` + `showSchemaForm`)

## Development

```bash
npm install
npm run build
npm test
```

Link into a local Homebridge install with `npm link` from this directory, then `npm link homebridge-terramow-v600` in your Homebridge directory.

## License

Apache-2.0
