# Distributed Voice Nodes over WebSocket instead of local STT

STT and VAD run on distributed Voice Nodes (Raspberry Pi devices), not on the housekeeper server. Each node connects to the server via WebSocket, sends transcribed Utterances as text, and receives TTS audio responses rendered server-side by Piper.

## Considered options

- **Local STT on server** (prior approach) — server owns a mic, runs whisper-cli per segment. Simple single-machine setup. Breaks down with multiple rooms: no way to know which room a question came from, so TTS response has no routing target. Also requires the server to have a mic attached.
- **Distributed Voice Nodes over WebSocket** (chosen) — each Pi registers with a label, location, and capabilities (`mic` or `mic+speaker`). Server is mic-free; it receives text utterances and routes TTS audio back to the originating node. Scales naturally to N rooms.

## Decision criteria

| | Local STT | Distributed Voice Nodes |
|---|---|---|
| Multi-room support | No | Yes — response routes to originating node |
| LLM location context | No | Yes — location string injected into prompt |
| Server hardware req | Needs mic | Mic-free |
| Complexity | Low | Medium (WebSocket server, node registry) |
| Dev/test setup | Simple | Run a node client at localhost |

## Consequences

- `VadWhisperAdapter` and all local STT code removed from server
- `SpeechInput` port replaced with a `VoiceNodeServer` abstraction that carries `nodeId` on each Utterance
- Voice Nodes are a separate project (see `docs/voice-node-project-reference.md`)
- A **Default Output Node** must be configured system-wide for routing TTS when the originating node is mic-only
- If the Default Output Node is offline, the TTS response is logged and dropped — no queuing
- ADR 0003 (whisper.cpp subprocess) superseded by this decision; STT engine choice is now a Voice Node concern, not a server concern
