Status: needs-triage

# Voice-driven Automation creation

## What to build

Full end-to-end loop: speak a command → Directed Question classified → Device Labels resolved → Automation written to `automations.json` → visible in dashboard. This is the core value proposition of the system.

## Acceptance criteria

- [ ] `ClassifiedIntent` consumer resolves trigger/actuator Device Labels against `DeviceRepository`
- [ ] If Labels not found, system responds with TTS error ("I don't know a device called X")
- [ ] Valid intent creates a new Automation in `AutomationRepository`
- [ ] New Automation immediately appears in dashboard without page refresh
- [ ] New Automation is active and evaluated by execution engine on next Trigger event
- [ ] Duplicate Automations (same Trigger + Actuator) handled gracefully (update or reject with message)

## Blocked by

- Issue 05 (Automation CRUD)
- Issue 08 (Directed Question classification)
