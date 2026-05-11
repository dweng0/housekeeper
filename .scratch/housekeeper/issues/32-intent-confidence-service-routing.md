Status: done

# Intent Confidence: service routing + cache bypass

## What to build

Update `VoiceAutomationService` to read `intentConfidence` from the Classified Intent and route to `hedgedResponse` (via live TTS) when below threshold, bypassing the Response Audio Cache. Above threshold behaves as today.

## Acceptance criteria

- [ ] `VoiceAutomationService` reads `intentConfidenceThreshold` from config (default `0.7` if absent)
- [ ] `intentConfidence >= threshold` → use `response` / `spokenResponse`, cache lookup as today
- [ ] `intentConfidence < threshold` → use `hedgedResponse` via live TTS, skip `responseAudioCache.lookup()`
- [ ] Applies to all intent types: `device-control`, `query`, `create-automation`, `set-resident`
- [ ] `unknown` type unchanged — silent, no confidence check
- [ ] Unit tests: high-confidence path uses cache; low-confidence path skips cache, speaks `hedgedResponse`
- [ ] All existing tests pass

## Blocked by

- #31 intent-confidence-classifier ✓
