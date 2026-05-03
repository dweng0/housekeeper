Status: done

# Always-on STT + Listening Window

## What to build

Per-Voice-Node rolling Listening Window maintained on the server. When the System Name is detected in an Utterance from any connected Voice Node, the full window for that node is dispatched for classification.

## Acceptance criteria

- [x] `makeListeningWindow` implemented — rolling window, configurable duration (default 15s)
- [x] System Name detection case-insensitive, fires `onDirectedQuestion` with full window transcript
- [x] System Name configurable via `SYSTEM_NAME` env var (default `"housekeeper"`)
- [x] Per-Voice-Node windows: `VoiceAutomationService` maintains a `Map<nodeId, ListeningWindow>`
- [x] New window created lazily on first utterance from a node
- [x] `SpeechInput` port replaced with `VoiceNodeHub` — utterances carry `nodeId`

## Notes

- STT and VAD live on the edge (Voice Node / Pi). Server receives text only.
- See ADR 0004 for architecture rationale.
- See `docs/voice-node-project-reference.md` for Pi-side implementation guidance.

## Blocked by

None — complete.
