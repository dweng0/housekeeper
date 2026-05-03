Status: done

# VoiceNodeHub WebSocket server

## What to build

Implement the `VoiceNodeHub` port as a WebSocket server following `docs/voice-node-protocol.md`.

## Acceptance criteria

### Connection
- [ ] WebSocket server on `VOICE_NODE_PORT` (default `3001`)
- [ ] Multiple simultaneous Voice Node connections supported
- [ ] Node that doesn't send `register` within 5s is disconnected

### Registration
- [ ] `register` message persisted to `data/voice-nodes.json` (`VoiceNodeRepository`)
- [ ] First-time node: `status: "new"` in `registered` response, surfaced as unconfirmed in dashboard
- [ ] Returning node: `status: "reconnected"`, active immediately
- [ ] Reconnect with same `id` resumes existing registration — no duplicate entries

### Utterances
- [ ] `utterance` message before `register` returns `{ type: "error", code: "REGISTRATION_REQUIRED" }`
- [ ] Valid `utterance` fires `onUtterance(nodeId, text)` callback (nodeId inferred from connection)
- [ ] `INVALID_MESSAGE` error returned for unrecognised type or missing fields

### TTS dispatch
- [ ] `sendTts(nodeId, audio)` sends audio as a **binary** WebSocket frame (raw PCM, not base64)
- [ ] If `nodeId` not connected: log and no-op

### Port interface
- [ ] `getNode(nodeId)` returns registered `VoiceNode` or `undefined`
- [ ] `getConnectedNodes()` returns only currently-connected nodes
- [ ] `start()` / `stop()` control server lifecycle

### Wiring
- [ ] `VoiceNodeHub` wired into `VoiceAutomationService` in `src/index.ts`

## Protocol reference

See `docs/voice-node-protocol.md` for full message specs.

## Blocked by

None — port interface exists, protocol defined. Can implement now.
