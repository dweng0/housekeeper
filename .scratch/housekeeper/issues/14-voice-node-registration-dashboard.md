Status: done

# Voice Node registration + dashboard management

## What to build

Dashboard UI for managing registered Voice Nodes — similar to the Device management UI. Shows connected/disconnected nodes, allows labelling unregistered nodes, and exposes the Default Output Node selector.

## Acceptance criteria

- [ ] `GET /api/voice-nodes` — list all registered Voice Nodes with connection status (online/offline)
- [ ] `GET /api/voice-nodes/unregistered` — nodes that have connected but not yet been confirmed
- [ ] `PUT /api/voice-nodes/:id` — update label or location of a registered node
- [ ] `DELETE /api/voice-nodes/:id` — remove a node from the registry
- [ ] `GET /api/config` and `PUT /api/config` extended with `defaultOutputNodeId` field
- [ ] Dashboard page: Voice Nodes list showing label, location, capabilities, online status
- [ ] Dashboard: unregistered nodes surfaced for confirmation (same pattern as MQTT auto-discovery)
- [ ] Dashboard: Default Output Node selector (dropdown of mic+speaker nodes)

## Blocked by

- Issue 13 (VoiceNodeHub WebSocket server)
