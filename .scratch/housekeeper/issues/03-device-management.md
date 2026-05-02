Status: done

# Device management (CRUD + dashboard)

## What to build

Full vertical slice for registering, editing, and deleting Devices with Labels. Cuts through the `DeviceRepository` JSON adapter, Express HTTP routes, and the dashboard UI (shadcn table + form).

## Acceptance criteria

- [x] `DeviceRepository` adapter reads/writes `data/devices.json`
- [x] Express routes: `GET /devices`, `POST /devices`, `PUT /devices/:id`, `DELETE /devices/:id`
- [x] Dashboard shows Device list (Label, MQTT topic, type: Sensor/Actuator)
- [x] Dashboard form creates and edits a Device
- [x] Delete removes Device from `devices.json`
- [x] A Device with no Label cannot be saved

## Blocked by

- Issue 01 (project scaffold)
