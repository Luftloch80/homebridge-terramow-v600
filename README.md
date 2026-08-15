# homebridge-terramow-v600

Homebridge plugin for the **TerraMow V600** (and other TerraMow models with the local MQTT Home Assistant interface).

The mower runs an on-device MQTT broker. This plugin connects over your LAN — no cloud account required.

## Native vacuum in Apple Home (like Roborock)

Apple Home only shows the real **robot vacuum** icon via **Matter**. If you see a **Fan**, Matter is not enabled on the bridge running this plugin.

1. Plugins → TerraMow V600 → enable **Child Bridge**
2. Enable **Matter** on that child bridge
3. Keep Presentation mode = **Native vacuum (Matter)** (default)
4. Restart Homebridge
5. In Apple Home: **delete** any old TerraMow Fan accessory
6. In Homebridge logs, find **`Commissioning codes for <mower name>`**
7. Apple Home → **Add Accessory** → More options → enter that **Manual Code** (or QR)

The vacuum is an **external** Matter accessory. Its pairing code is **not** the child-bridge Matter code. Using the wrong code often shows as a **PASE** / commissioning error.

### Matter PASE / pairing failed

- Use the mower’s own code from the log line above, then restart and re-pair if a previous attempt failed half-way
- Phone, HomePod/Apple TV hub, and Homebridge must be on the **same LAN** (no guest Wi‑Fi / AP isolation)
- Matter needs working **mDNS** and usually **IPv6** on the LAN
- After a failed attempt: remove the incomplete accessory in Apple Home, restart Homebridge, pair again with a fresh code

`mode: "hap"` forces the Fan fallback (only if you cannot use Matter).

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
