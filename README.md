# homebridge-terramow-v600

Homebridge plugin for the **TerraMow V600** (and other TerraMow models that expose the local Home Assistant MQTT interface).

The mower runs an on-device MQTT broker. This plugin connects over your LAN — no cloud account required.

## Requirements

- Homebridge 1.8+ / 2.x
- TerraMow firmware **6.6.0+** and app **1.6.0+**
- Home Assistant integration enabled in the TerraMow app (this turns on the MQTT broker and shows the password)

## Install

```bash
npm install -g homebridge-terramow-v600
```

Or install from the Homebridge UI plugin search: **TerraMow V600**.

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

## Development

```bash
npm install
npm run build
npm test
```

Link into a local Homebridge install with `npm link` from this directory, then `npm link homebridge-terramow-v600` in your Homebridge directory.

## License

Apache-2.0
