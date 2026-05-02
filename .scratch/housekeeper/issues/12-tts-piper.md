Status: needs-triage

# TTS engine: Piper

## What to build

Wire the `SpeechOutput` port so the system can speak AI responses aloud. `PiperTtsAdapter` at `src/voice/piper-tts-adapter.ts` is implemented; this issue covers model download, integration into the main request/response loop, and an ADR.

## Acceptance criteria

- [ ] Voice model fetch script at `scripts/download-piper-voice.sh` — downloads `en_US-lessac-medium.onnx` + `.json` into `data/piper-voices/` on first run
- [ ] `devenv up` (or a documented `devenv shell` step) runs the fetch script if models are absent
- [ ] `PiperTtsAdapter` wired in `src/index.ts` using `PIPER_VOICE` env var
- [ ] After directed-question classification returns a response string, `SpeechOutput.speak()` is called with that string
- [ ] ADR written at `docs/adr/0003-tts-engine-piper.md`
- [ ] `aplay` present in devenv packages (or confirmed available on target OS)

## Notes

- Piper writes raw PCM to stdout; piped to `aplay -r 22050 -f S16_LE -t raw -`
- `en_US-lessac-medium` is a good quality/speed tradeoff; swap via `PIPER_VOICE` env var
- Model files are large (~65 MB); gitignored, not committed

## Blocked by

Issue 08 (directed-question classification) — need response string to speak.
