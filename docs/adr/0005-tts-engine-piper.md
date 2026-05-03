# TTS engine: Piper via subprocess

The `SpeechOutput` port renders text-to-speech using `piper` (from `pkgs.piper-tts`), spawned as a subprocess. Piper writes raw PCM to stdout; the server captures it and routes the audio buffer to the target Voice Node via `VoiceNodeHub.sendTts()`.

## Considered options

- **Piper subprocess** (chosen) — `pkgs.piper-tts` in nixpkgs. Outputs raw PCM to stdout, making it easy to capture and pipe. High-quality neural TTS. Voice swappable via `PIPER_VOICE` env var.
- **espeak** — low quality, robotic voice. Acceptable for system messages but poor for general responses.
- **Cloud TTS (ElevenLabs, OpenAI)** — highest quality, but requires internet, API key, and adds latency. Unacceptable for a local-first home system.
- **Coqui TTS** — open source neural TTS, but not in nixpkgs; requires Python sidecar.

## Decision criteria

| | Piper | espeak | Cloud TTS |
|---|---|---|---|
| Voice quality | High | Low | Highest |
| Local/offline | Yes | Yes | No |
| Nixpkgs package | Yes | Yes | No |
| PCM stdout capture | Yes | Yes | No |
| Voice variety | Good | Limited | Excellent |

## Consequences

- `PiperTtsAdapter` spawns `piper --model <path> --output-raw`, writes text to stdin, captures PCM from stdout
- PCM format: 22050 Hz, 16-bit signed LE (mono) — sent as binary WebSocket frame to Voice Node
- Voice model files (~65 MB each) are gitignored; downloaded via `scripts/download-piper-voice.sh`
- `PIPER_VOICE` env var points to the `.onnx` model file path
- Response routed to originating Voice Node if it has `"speaker"` capability; falls back to `defaultOutputNodeId` from `AppConfig`
