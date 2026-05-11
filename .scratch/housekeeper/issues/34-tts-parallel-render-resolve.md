Status: done

# TTS: parallelize render and resolveTarget

## What to build

In both `openai-tts-adapter.ts` and `piper-tts-adapter.ts`, `speak()` awaits the full TTS render before calling `resolveTarget()`. These are independent — run them with `Promise.all`. If target resolves to null, skip sending (audio already rendered, just drop it).

## Acceptance criteria

- [ ] `speak()` in `OpenAiTtsAdapter` runs `render` and `resolveTarget` concurrently via `Promise.all`
- [ ] `speak()` in `PiperTtsAdapter` runs `render` and `resolveTarget` concurrently via `Promise.all`
- [ ] If `resolveTarget` returns null, rendered audio is discarded without error
- [ ] All existing TTS routing integration tests pass

## Blocked by

None — can start immediately
