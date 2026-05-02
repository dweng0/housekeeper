# Context Map

## Contexts

- [Voice](./src/voice/CONTEXT.md) — always-on STT, Listening Window, Directed Question classification
- [Automation](./src/automation/CONTEXT.md) — Device registry, Automation rules, MQTT execution engine
- [Memory](./src/memory/CONTEXT.md) — Resident sessions, household memory via mem0

## Relationships

- **Voice → Automation**: Voice emits a classified `DirectedQuestion`; Automation resolves Device Labels and creates or fires Automations
- **Voice → Memory**: Voice scopes each `DirectedQuestion` to the active Resident session (or household fallback)
- **Automation ↔ Memory**: Automation may read Resident preferences from Memory to personalise Action execution

## Delivery mechanisms (not contexts)

- `HttpApi` — Express server; routes requests to the relevant context
- `DashboardUI` — React + Vite + shadcn/ui; reads from Automation and Memory contexts via HttpApi

## Data

JSON files owned by the Automation context, stored at project root under `data/`:

- `data/devices.json`
- `data/automations.json`
