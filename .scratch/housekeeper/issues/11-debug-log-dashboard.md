Status: needs-triage

# Debug log dashboard

## What to build

Dashboard view logging all Directed Questions (transcript, classified intent, outcome) and all Automation firings (trigger event, action dispatched, timestamp). Used for debugging the voice pipeline and verifying Automation behaviour.

## Acceptance criteria

- [ ] Server persists log entries for Directed Questions: timestamp, raw transcript, classified intent JSON, outcome (Automation created / not a directed question / error)
- [ ] Server persists log entries for Automation firings: timestamp, Automation ID, trigger MQTT message, action MQTT message
- [ ] Dashboard log view shows both entry types in chronological order (newest first)
- [ ] Log entries filterable by type (Directed Questions / Automation firings)
- [ ] Log view auto-refreshes (polling or WebSocket)

## Blocked by

- Issue 09 (voice-driven Automation creation)
