Status: done

# Automation CRUD (dashboard)

## What to build

Full vertical slice for creating, editing, and deleting Automations via the dashboard. Automations reference Devices by Label. Cuts through the `AutomationRepository` JSON adapter, Express routes, and dashboard UI (shadcn form + list).

## Acceptance criteria

- [x] `AutomationRepository` adapter reads/writes `data/automations.json`
- [x] Express routes: `GET /automations`, `POST /automations`, `PUT /automations/:id`, `DELETE /automations/:id`
- [x] Dashboard lists Automations (Trigger Device Label → Action Device Label)
- [x] Dashboard form creates an Automation: pick Trigger Sensor by Label, pick Actuator by Label, set optional duration
- [x] Automation cannot reference a Device Label that does not exist in `devices.json`
- [x] Automations can be enabled/disabled via toggle in dashboard

## Blocked by

- Issue 03 (Device management)
