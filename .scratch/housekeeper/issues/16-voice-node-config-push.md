Status: done

# Voice Node remote config push

## What to build

Allow the dashboard to push config changes (label, location, audio devices) to a connected Voice Node over the existing WebSocket connection. The voicenode client already implements `config_update` handling and ACKs with `config_updated` — housekeeper has no server-side support.

## Protocol (already implemented in voicenode client)

**Server → Node:**
```json
{
  "type": "config_update",
  "label": "Kitchen",
  "location": "kitchen counter",
  "devices": { "input": "hw:1,0", "output": "hw:1,0" }
}
```
All fields optional. Node validates device IDs against locally available hardware.

**Node → Server (ACK):**
```json
{ "type": "config_updated", "success": true }
```
or on failure:
```json
{ "type": "config_updated", "success": false, "error": "Invalid input device ID: hw:9,0" }
```

## Acceptance criteria

- [x] `VoiceNodeHub` port gains `sendConfig(nodeId, patch)` method — patch is `Partial<{ label: string, location: string, devices: { input?: string, output?: string } }>`
- [x] `WebSocketVoiceNodeHub` implements `sendConfig` — sends `config_update` JSON frame to the target node
- [x] Server handles incoming `config_updated` ACK — logs failure, no crash
- [x] `PUT /api/voice-nodes/:id` triggers `sendConfig` when the node is currently connected (no-op if offline, update persisted either way)
- [x] `voice-node-protocol.md` documents `config_update` / `config_updated` message shapes

## Out of scope

- Audio device discovery via server (node validates locally)
- Queuing config pushes for offline nodes (update persists; push fires on next reconnect is a future concern)

## Blocked by

- Issue 13 (VoiceNodeHub WebSocket server)
- Issue 14 (Voice Node registration + dashboard management)
