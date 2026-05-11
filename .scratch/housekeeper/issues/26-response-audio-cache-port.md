Status: done

# ResponseAudioCache port + wiring into VoiceAutomationService

## What to build

Define the `ResponseAudioCache` port and wire it into `VoiceAutomationService`. On a `device-control` success outcome, consult the cache before calling `speechOutput.speak()` — a hit sends the pre-rendered WAV buffer directly via `hub.sendTts()`, a miss falls through to live TTS unchanged. Ship with a `NullResponseAudioCache` stub so runtime behaviour is identical to today.

## Acceptance criteria

- [x] `ResponseAudioCache` port defined in `ports.ts` with `lookup({ deviceLabel, command }): Promise<Buffer | null>` method
- [x] `NullResponseAudioCache` stub returns `null` for all lookups
- [x] `VoiceAutomationService` accepts `ResponseAudioCache` as optional dep (defaults to null stub)
- [x] On `device-control` success: cache hit → `hub.sendTts()` with buffer, skips `speechOutput.speak()`
- [x] On cache miss: falls through to `speechOutput.speak()` as today
- [x] Unit tests cover hit path, miss path, and absent dep (stub behaviour)
- [x] All existing tests pass unchanged

## Blocked by

None — can start immediately
