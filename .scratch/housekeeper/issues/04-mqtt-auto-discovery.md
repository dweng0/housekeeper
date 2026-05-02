Status: done

# MQTT auto-discovery

## What to build

Watch the MQTT broker for new topics and surface unregistered Devices in the dashboard for labelling. Include a toggle to disable auto-discovery for security.

## Acceptance criteria

- [x] Server subscribes to `#` wildcard when auto-discovery is enabled
- [x] New MQTT topic not in `devices.json` appears in dashboard as unregistered Device
- [x] User can assign a Label to an unregistered Device (promotes it to a registered Device)
- [x] Auto-discovery toggle persists in config (env var or config file)
- [x] When auto-discovery is off, new MQTT topics are silently ignored

## Blocked by

- Issue 03 (Device management)

## Implementation

- `src/config/json-config-repository.ts` — persists `data/config.json` with `autoDiscovery` flag
- `src/device/auto-discovery-service.ts` — subscribes to `#` wildcard via `mqtt` package; tracks unregistered topics in-memory; starts/stops based on config
- `src/index.ts` — `GET/PUT /api/config`, `GET /api/unregistered-devices` endpoints; syncs discovery on boot and on config change
- `client/src/App.tsx` — auto-discovery toggle switch; unregistered devices table with "Assign Label" action
- Requires `MQTT_URL` env var; if unset, gateway is a no-op (safe default)
