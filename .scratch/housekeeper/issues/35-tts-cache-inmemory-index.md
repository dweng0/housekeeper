Status: done

# TTS: in-memory index cache for ResponseAudioCache

## What to build

`json-response-audio-cache.ts` parses `index.json` from disk on every `lookup()` and `lookupNotFound()` call. Lazy-load the parsed index into a closure variable on first access and reuse it. Cache hits drop from two disk reads (index + audio file) to one (audio file only).

The index is written only by the cache builder at startup or device-add time, not during utterance flow — no invalidation required.

## Acceptance criteria

- [ ] `makeJsonResponseAudioCache` holds parsed index in a closure-level variable after first read
- [ ] Subsequent `lookup()` / `lookupNotFound()` calls skip the `readFile` for `index.json`
- [ ] If `index.json` does not exist on first access, cache returns null (same as before)
- [ ] All existing cache tests pass

## Blocked by

None — can start immediately
