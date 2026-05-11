Status: done

# Response Audio Cache: auto-generate entries on device add

## What to build

When a new device is saved (registered or confirmed), immediately trigger `ResponseAudioCacheBuilder` for that device's entries in the background. No restart required. Log start and completion. Existing cache entries for other devices are untouched.

## Acceptance criteria

- [x] Device save (POST/PUT in device router or repository) triggers background cache generation for the new device
- [x] Only the new device's `{label, command}` pairs are built — no full rebuild
- [x] Build runs in background; device save response is not delayed
- [x] Logs `[CacheBuilder] new device "hallway light" — generating cache entries…` and `[CacheBuilder] hallway light entries ready`
- [x] After generation completes, cache hits work immediately for the new device without restart
- [x] If build fails, error is logged and system falls through to live TTS (no crash)

## Blocked by

- #27 response-audio-cache-builder ✓

## Delivered

- `src/voice/response-audio-cache-builder.ts` — `buildForDevice(device)` method: generates only that device's pairs, no pruning, isolated from `build()`
- `src/index.ts` — `cacheBuilder` hoisted to module scope; POST/PUT device handlers fire `cacheBuilder?.buildForDevice(device).catch(...)` after save
- 3 new builder tests: generates only new device's pairs, doesn't prune others, skips complete entries
