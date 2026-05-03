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

## Connection lifecycle

```
Node                          Server
 |                              |
 |--- connect ----------------->|
 |--- register ---------------->|
 |<-- registered ---------------|
 |                              |
 |--- utterance --------------->|  (repeated, as speech is detected)
 |<-- tts (binary) -------------|  (if Directed Question triggers response)
 |                              |
 |--- disconnect -------------->|  (or connection drops)
 |                              |  server retains ListeningWindow state
 |--- connect ----------------->|  (reconnect after network drop)
 |--- register ---------------->|  (same id)
 |<-- registered (reconnected) -|
```

On disconnect, the server retains the node's Listening Window. Utterances from before the drop remain in context when the node reconnects.

---

## Default Output Node fallback

If the server needs to respond but the originating node has no `"speaker"` capability, audio is sent to the configured Default Output Node instead. If the Default Output Node is offline, the response is logged and dropped — no queuing.
