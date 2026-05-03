Status: done

# TTS response routing to Voice Nodes

## What to build

`SpeechOutput.speak(text, originatingNodeId)` renders TTS via Piper and routes the audio to the correct Voice Node. Falls back to the Default Output Node if the originating node has no speaker.

## Acceptance criteria

- [ ] `PiperTtsAdapter` updated — `speak(text, originatingNodeId)` signature
- [ ] If originating node has `"speaker"` capability: send audio via `VoiceNodeHub.sendTts(nodeId, audio)`
- [ ] If originating node is mic-only: send to Default Output Node instead
- [ ] If Default Output Node is offline or unset: log warning and drop (no queue)
- [ ] `PiperTtsAdapter` has access to `VoiceNodeHub` to check capabilities and dispatch audio
- [ ] Wired in `src/index.ts`

## Blocked by

- Issue 12 (TTS engine: Piper) — Piper adapter must be working first
- Issue 13 (VoiceNodeHub) — needs `sendTts` and `getNode` to be implemented
- Issue 14 (dashboard) — Default Output Node config must be readable from `AppConfig`
