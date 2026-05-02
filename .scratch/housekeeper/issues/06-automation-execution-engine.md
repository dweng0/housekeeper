Status: needs-triage

# Automation execution engine

## What to build

Subscribe to MQTT, evaluate Triggers on incoming events, and dispatch Actions to Actuators. No AI involved. Verifiable by publishing a test MQTT message and observing the Action fire.

## Acceptance criteria

- [ ] Server subscribes to MQTT topics for all registered Sensor Devices on startup
- [ ] Incoming MQTT message evaluated against all enabled Automations
- [ ] Matching Automation fires its Actions (publishes MQTT message to Actuator topic)
- [ ] Duration-based Actions (e.g. "turn on for 30 seconds") auto-reverse after timeout
- [ ] Disabled Automations are skipped
- [ ] Engine reloads `automations.json` when file changes (no restart required)

## Blocked by

- Issue 04 (MQTT auto-discovery)
- Issue 05 (Automation CRUD)
