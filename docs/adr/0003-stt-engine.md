# STT engine: whisper.cpp subprocess

The `SpeechInput` adapter spawns `whisper-stream` (from `whisper-cpp`) as a child process, reading transcription lines from its stdout. This mirrors how `PiperTtsAdapter` drives the `piper` binary.

## Considered options

- **whisper.cpp subprocess** (chosen) — `pkgs.whisper-cpp` in nixpkgs provides `whisper-stream`, a ready-made binary for real-time microphone capture and transcription. Matches the existing piper-tts adapter pattern exactly: spawn process, pipe streams, no new architectural concepts. GGML int8 models keep CPU overhead acceptable for always-on use.
- **faster-whisper Python sidecar** — CTranslate2 int8 inference, lowest latency per segment, but adds a Python runtime dependency and requires a stdio/HTTP IPC layer that the project doesn't have yet.
- **whisper-node (npm bindings)** — TypeScript-native, but native Node.js bindings complicate the devenv setup (node-gyp, platform-specific prebuilds) and offer no advantage over the subprocess approach for always-on streaming.

## Decision criteria

| | whisper.cpp subprocess | faster-whisper sidecar | whisper-node bindings |
|---|---|---|---|
| Latency (always-on) | acceptable (stream mode) | best | acceptable |
| CPU (int8 model) | good | best | good |
| TS integration complexity | low (same as piper) | medium (IPC layer) | high (native bindings) |
| Nixpkgs package | `pkgs.whisper-cpp` | Python pkg, extra work | not in nixpkgs |

## Consequences

- `whisper-stream` outputs partial and final transcription lines to stdout; the adapter must distinguish final lines (whisper.cpp prefixes them with `[...-->...]`) to avoid firing `onUtterance` on partials.
- A GGML model file must be present at the path in `WHISPER_MODEL`. The `tiny.en` or `base.en` model is sufficient for home assistant utterances and keeps CPU low.
- VAD is handled by whisper.cpp internally; no separate VAD layer needed.
