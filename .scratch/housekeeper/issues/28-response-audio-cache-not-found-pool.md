Status: done

# Response Audio Cache: __not_found__ generic negative pool

## What to build

Extend `ResponseAudioCacheBuilder` to generate a shared `__not_found__` pool of generic device-not-registered audio variants. Built alongside positive entries at cache build time. `VoiceAutomationService` plays a random variant from the pool when device lookup fails, replacing the live TTS fallback `"I don't know a device called X"`.

## Acceptance criteria

- [x] Builder generates N generic negative text variants via LLM (e.g. "I don't have a device with that name registered"), renders to WAV
- [x] Pool stored under `__not_found__` key in `data/response-cache/index.json`
- [x] `ResponseAudioCache` port exposes `lookupNotFound(): Promise<Buffer | null>`
- [x] `VoiceAutomationService` uses `lookupNotFound()` on unknown-device path; falls through to live TTS on null
- [x] Random variant selected on each playback
- [x] Integration test: unknown device → cached generic audio plays (not live TTS)

## Blocked by

- #27 response-audio-cache-builder ✓

## Delivered

- `src/ports.ts` — `lookupNotFound()` on `ResponseAudioCache`; `generateNotFoundVariants()` on `ResponseTextGenerator`
- `src/voice/null-response-audio-cache.ts` — returns null for `lookupNotFound`
- `src/voice/json-response-audio-cache.ts` — reads `__not_found__` from index, picks random variant
- `src/voice/response-audio-cache-builder.ts` — generates `__not_found__` pool, skips pruning for it
- `src/voice/openai-response-text-generator.ts` — `generateNotFoundVariants` with device-agnostic prompt
- `src/voice/voice-automation-service.ts` — unknown-device path uses `lookupNotFound()`, falls through to live TTS on null
- 2 new VoiceAutomationService tests (not-found hit, not-found miss)
- 2 new builder tests (generates pool, skips complete pool)
