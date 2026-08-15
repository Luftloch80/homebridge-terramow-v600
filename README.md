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

HomeKit has no native lawn-mower / robot-vacuum HAP type, so the mower is exposed as a **Fanv2 vacuum-style** accessory (same pattern used by popular vacuum plugins), plus helper switches and sensors.

| Service | Behavior |
| --- | --- |
| **Vacuum (Fan)** | On = start / resume mowing. Off = return to dock. Rotation speed = job progress %. |
| **Pause** switch | On = pause. Off = resume. |
| **Return Home** switch | On = dock. Off while returning = resume. |
| **Battery** | Level, charging state, low-battery status. |
| **At Base** contact | Docked or charger connected. |
| **Returning** contact | Heading home. |
| **Fault** contact | Error or disconnected. |
| **Rain Delay** leak | Rain caused a return. |
| **Mowing** occupancy | Currently mowing. |
| **Working** motion | Mowing or returning. |
| **Charger Connected** contact | Adapter connected. |
| **Battery Temp Alert** contact | Battery over/under temperature. |
| **Night Delay** contact | Waiting for daylight / night return. |
| **Motor Overheat** contact | Motor/wheel overheat return. |
| **Map Ready** contact | Complete map detected. |
| **Schedule Upcoming** contact | Next schedule exists. |
| **Blade Wear** filter | Blade maintenance life %. |
| **Base Station Wear** filter | Base station maintenance life %. |
| **Job Progress** humidity | Current job progress 0–100%. |
| **Cleaned Area** light | Session/total cleaned area readout. |

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
