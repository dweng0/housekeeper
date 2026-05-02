Status: needs-triage

# Automation CRUD (dashboard)

## What to build

Full vertical slice for creating, editing, and deleting Automations via the dashboard. Automations reference Devices by Label. Cuts through the `AutomationRepository` JSON adapter, Express routes, and dashboard UI (shadcn form + list).

## Acceptance criteria

- [ ] `AutomationRepository` adapter reads/writes `data/automations.json`
- [ ] Express routes: `GET /automations`, `POST /automations`, `PUT /automations/:id`, `DELETE /automations/:id`
- [ ] Dashboard lists Automations (Trigger Device Label → Action Device Label)
- [ ] Dashboard form creates an Automation: pick Trigger Sensor by Label, pick Actuator by Label, set optional duration
- [ ] Automation cannot reference a Device Label that does not exist in `devices.json`
- [ ] Automations can be enabled/disabled via toggle in dashboard

## Blocked by

- Issue 03 (Device management)
