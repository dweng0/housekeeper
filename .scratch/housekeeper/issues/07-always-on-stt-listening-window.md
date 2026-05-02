Status: needs-triage

# Always-on STT + Listening Window

## What to build

Microphone input feeds always-on STT. A rolling Listening Window holds the recent transcript. When the System Name is detected, the system enters capture mode and waits for a Speech Boundary (VAD debounce ~700ms) before dispatching the full Listening Window for classification.

## Acceptance criteria

- [ ] STT runs continuously from microphone input
- [ ] Listening Window maintains a rolling transcript (configurable duration, default 15s)
- [ ] System Name is configurable (env var, default "Jarvis")
- [ ] System Name detection (case-insensitive) in transcript triggers capture mode
- [ ] Speech Boundary detected via VAD silence debounce (~700ms, configurable)
- [ ] On Speech Boundary: full Listening Window dispatched as a `PendingDirectedQuestion` event
- [ ] `SpeechInput` port interface satisfied by the chosen STT adapter (from issue 02)

## Blocked by

- Issue 01 (project scaffold)
- Issue 02 (STT engine selection)
