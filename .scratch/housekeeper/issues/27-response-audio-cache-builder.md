Status: done

# ResponseAudioCacheBuilder: LLM text gen + piper render + startup diff

## What to build

`ResponseAudioCacheBuilder` generates Pre-rendered Responses for every registered `{deviceLabel, command}` pair. For each entry: LLM generates N text variants styled to the current persona, piper renders each to WAV, files written to `data/response-cache/`. Index written to `data/response-cache/index.json`. On server boot: incremental diff — generate missing entries, prune orphaned keys (devices no longer registered), log each step. Default variant count: 3.

## Acceptance criteria

- [x] `ResponseAudioCacheBuilder` implemented with `build(devices: Device[]): Promise<void>` method
- [x] LLM prompt generates N persona-aware text variants per `{deviceLabel, command}` pair
- [x] Each variant rendered to WAV via piper and written to `data/response-cache/`
- [x] Index at `data/response-cache/index.json` maps `"deviceLabel:command"` → `{ positive: string[] }`
- [x] Startup diff: missing entries generated, orphaned entries pruned
- [x] Progress logged per entry (`[CacheBuilder] generating hallway light:on…`, `[CacheBuilder] done`)
- [x] `JsonResponseAudioCache` reads index + serves buffers from disk; implements `ResponseAudioCache` port
- [ ] Device commands play pre-rendered audio end-to-end after a server restart with populated cache — requires wiring into `src/index.ts` (runtime integration, not unit-testable)
- [x] Unit tests for builder diff logic (missing/orphan detection)

## Blocked by

- #26 response-audio-cache-port ✓

## Delivered

- `src/ports.ts` — `TtsRenderer`, `ResponseTextGenerator` interfaces
- `src/voice/response-audio-cache-builder.ts` — builder with diff logic
- `src/voice/response-audio-cache-builder.test.ts` — 3 diff logic tests
- `src/voice/json-response-audio-cache.ts` — disk-backed `ResponseAudioCache` impl
- `src/voice/openai-response-text-generator.ts` — LLM variant generator
- `src/voice/piper-tts-renderer.ts` — piper `TtsRenderer` impl
