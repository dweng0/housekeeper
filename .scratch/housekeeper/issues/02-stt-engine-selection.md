Status: done

# STT engine selection

## What to build

Decide which STT library backs the `SpeechInput` port. The choice shapes the adapter implementation significantly. Evaluate options, pick one, record the decision as an ADR.

## Acceptance criteria

- [x] Options evaluated: Whisper.cpp Node bindings, Python sidecar (faster-whisper), other
- [x] Decision made on criteria: latency, CPU usage, TypeScript integration complexity
- [x] ADR written at `docs/adr/0003-stt-engine.md`
- [x] Chosen engine added to devenv.sh as a dependency

## Blocked by

None — can start immediately (parallel to issue 01).
