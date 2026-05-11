Status: done

# TTS: Piper daemon TtsRenderer

## What to build

`piper-tts-renderer.ts` spawns a new `piper` process on every `render()` call, paying ~200–500ms process-spawn + model-load overhead each time. Add `makePiperDaemonTtsRenderer` — spawns piper once at startup in long-lived stdin mode, writes text lines in, reads PCM frames out. Auto-restarts the process on crash. Wire as the default renderer in `src/index.ts`, keeping `makePiperTtsRenderer` for reference.

Piper outputs raw PCM to stdout with no framing. The daemon renderer must delimit frames. Strategy: send one utterance at a time and read until stdout goes quiet (no bytes for N ms), then resolve. This matches how the current spawn-per-call approach works.

## Acceptance criteria

- [ ] `makePiperDaemonTtsRenderer(voicePath)` returns a `TtsRenderer` (same port as existing)
- [ ] Piper process spawned once at construction, reused across `render()` calls
- [ ] Process auto-restarts if it exits unexpectedly; in-flight `render()` rejects with an error
- [ ] `render()` resolves with correct PCM buffer for the given text
- [ ] `src/index.ts` wires `makePiperDaemonTtsRenderer` as the active Piper renderer
- [ ] Old `makePiperTtsRenderer` remains in codebase (not deleted)
- [ ] Unit/integration tests cover: normal render, crash-and-restart, concurrent render calls queue correctly

## Blocked by

None — can start immediately
