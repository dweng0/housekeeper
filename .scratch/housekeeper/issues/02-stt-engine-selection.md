Status: wontfix

# STT engine selection

## What to build

Decide which STT library backs the `SpeechInput` port. The choice shapes the adapter implementation significantly. Evaluate options, pick one, record the decision as an ADR.

## Acceptance criteria

- [x] Options evaluated: Whisper.cpp Node bindings, Python sidecar (faster-whisper), other
- [x] Decision made on criteria: latency, CPU usage, TypeScript integration complexity
- [x] ADR written at `docs/adr/0003-stt-engine.md`
- [x] Chosen engine added to devenv.sh as a dependency

## Superseded

ADR 0004 (distributed Voice Nodes) moves STT to edge devices. Server no longer owns STT. ADR 0003 is superseded. See `docs/voice-node-project-reference.md` for STT guidance in the separate Pi project.

## Blocked by

None — can start immediately (parallel to issue 01).
