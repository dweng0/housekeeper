# Voice Node WebSocket Protocol

Defines the message contract between Voice Nodes (Raspberry Pi clients) and the housekeeper server.

## Connection

Voice Nodes connect to `ws://<host>:3001`. The server accepts multiple simultaneous connections.

On connect, the node **must** send a `register` message within 5 seconds or the server closes the connection.

---

## Messages: Node → Server

### `register`

Sent immediately on connect. Required before any `utterance` messages are accepted.

```json
{
  "type": "register",
  "id": "hallway-pi",
  "label": "Hallway",
  "location": "downstairs hallway",
  "capabilities": ["mic", "speaker"]
}
```

| Field | Type | Description |
|---|---|---|
| `id` | `string` | Stable identifier. Persisted on device (e.g. hostname or UUID). Used to resume registration on reconnect. |
| `label` | `string` | Human-readable name shown in dashboard. |
| `location` | `string` | Free-text room/area description. Injected as context into LLM prompt. |
| `capabilities` | `("mic" \| "speaker")[]` | At minimum `["mic"]`. Include `"speaker"` if node has audio output. |

**Server response:** `registered` (see below).

---

### `utterance`

Sent after VAD detects a Speech Boundary and Whisper transcribes the segment. Node sends raw transcript — System Name detection happens server-side.

```json
{
  "type": "utterance",
  "text": "housekeeper turn off the kitchen light"
}
```

| Field | Type | Description |
|---|---|---|
| `text` | `string` | Transcribed utterance text. Non-empty. |

No `nodeId` in the message body — the server infers it from the WebSocket connection.

---

## Messages: Server → Node

### `registered`

Sent in response to a valid `register` message.

```json
{
  "type": "registered",
  "id": "hallway-pi",
  "status": "new"
}
```

| Field | Values | Description |
|---|---|---|
| `status` | `"new"` \| `"reconnected"` | `"new"` = first time seen, awaiting dashboard confirmation. `"reconnected"` = previously registered, active immediately. |

---

### `tts_stream_start`

Sent when the server begins streaming TTS audio to this node. Signals that Pi should gate stop-word detection: suppress ambient listening and only match stop-words during the stream window.

```json
{
  "type": "tts_stream_start",
  "streamToken": "550e8400-e29b-41d4-a716-446655440000"
}
```

| Field | Type | Description |
|---|---|---|
| `streamToken` | `string` | Unique identifier for this stream. Correlates with `tts_stream_end`. |

**Pi expected behavior:**
- Gate stop-word detection: suppress ambient utterances, only match stop-word keywords
- Log: "Stream started: {streamToken}"
- Do NOT send acknowledgment

**Edge cases:**
- If `tts_stream_end` arrives before `tts_stream_start` (out-of-order): still restore normal listening on end
- If stream window opens but no audio chunks arrive: restore listening after 30 seconds (timeout)
- Connection drop during stream: implicit end on reconnect, resume normal listening

---

### `tts_stream_end`

Sent when the server finishes streaming TTS audio to this node. Signals that Pi should restore normal listening operation.

```json
{
  "type": "tts_stream_end",
  "streamToken": "550e8400-e29b-41d4-a716-446655440000"
}
```

| Field | Type | Description |
|---|---|---|
| `streamToken` | `string` | Matches the `streamToken` from corresponding `tts_stream_start`. |

**Pi expected behavior:**
- Restore normal listening: resume ambient utterance detection
- Log: "Stream complete: {streamToken}"
- Do NOT send acknowledgment

---

### `tts`

Sent when the server has a spoken response for this node. Payload is binary (raw PCM, 22050 Hz, 16-bit signed LE — Piper output format).

```
<binary WebSocket frame: raw PCM audio>
```

Node plays the audio immediately on its default output device.

> Binary frame rather than base64 JSON — avoids ~33% size overhead on audio payloads.

---

### `error`

Sent when the server rejects a message.

```json
{
  "type": "error",
  "code": "REGISTRATION_REQUIRED",
  "message": "send register before utterance"
}
```

| Code | Cause |
|---|---|
| `REGISTRATION_REQUIRED` | `utterance` received before `register` |
| `INVALID_MESSAGE` | Unrecognised message type or missing required fields |

---

### `config_update`

Sent when the dashboard updates a node's label, location, or audio device configuration. All fields are optional; only changed fields are included.

```json
{
  "type": "config_update",
  "label": "Kitchen",
  "location": "kitchen counter",
  "devices": { "input": "hw:1,0", "output": "hw:1,0" }
}
```

Node validates device IDs against locally available hardware and persists changes. Node must respond with `config_updated`.

---

## Messages: Node → Server (continued)

### `config_updated`

ACK sent in response to `config_update`. Sent on success and failure.

```json
{ "type": "config_updated", "success": true }
```

```json
{ "type": "config_updated", "success": false, "error": "Invalid input device ID: hw:9,0" }
```

---

## Connection lifecycle

```
Node                                    Server
 |                                       |
 |--- connect --------------------------->|
 |--- register --------------------------->|
 |<--- registered ------------------------|
 |                                       |
 |--- utterance --------------------------->|  (speech detected)
 |<--- tts_stream_start (streamToken) ----|  (Pi gates stop-word detection)
 |<--- tts (binary chunks, repeated) -----|  (Pi plays audio)
 |<--- tts_stream_end (streamToken) ------|  (Pi restores normal listening)
 |                                       |
 |--- utterance --------------------------->|  (repeated, as speech detected)
 |                                       |
 |--- disconnect ------------------------->|  (or connection drops)
 |                                       |  server retains ListeningWindow state
 |--- connect --------------------------->|  (reconnect after network drop)
 |--- register --------------------------->|  (same id)
 |<--- registered (reconnected) ---------|
```

**TTS Stream Lifecycle**: When the server sends a spoken response with `tts_stream_start`, the Pi gates stop-word detection (suppresses ambient listening, only matches stop-words). After stream chunks complete, `tts_stream_end` signals Pi to restore normal listening.

On disconnect, the server retains the node's Listening Window. Utterances from before the drop remain in context when the node reconnects.

---

## Default Output Node fallback

If the server needs to respond but the originating node has no `"speaker"` capability, audio is sent to the configured Default Output Node instead. If the Default Output Node is offline, the response is logged and dropped — no queuing.
