Status: ready-for-agent
Category: enhancement

## Parent

ADR 0015 — Conversation Finished Signal (`docs/adr/0015-conversation-finished-signal.md`)

## What to build

Add `conversationFinishedThreshold` to the system configuration, with dashboard UI for adjustment. Default value `0.5`.

End-to-end behavior:
- Dashboard shows threshold slider/field (default 0.5)
- Threshold stored in config
- Service reads threshold from config when evaluating `conversationFinished`
- User can tune sensitivity: lower = easier to close, higher = harder to close

## Acceptance criteria

- [ ] `AppConfig` type includes `conversationFinishedThreshold?: number`
- [ ] Default threshold `0.5` used when not configured
- [ ] Dashboard config UI includes threshold control
- [ ] Threshold persisted to config storage
- [ ] Service reads threshold from `ConfigRepository`
- [ ] Test: threshold boundary cases (0.49 vs 0.50 vs 0.51)

## Blocked by

- Issue 01 (`01-core-mechanism.md`) — threshold evaluation logic depends on core mechanism