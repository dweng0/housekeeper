# Voice Node — Separate Project Reference

Notes captured during architecture grilling. Use as starting point for the Pi-based voice node client project.

## What this project is

A lightweight Python server running on a Raspberry Pi that:
- Captures audio from mic (USB or Bluetooth)
- Runs VAD (energy-based or webrtcvad) to detect Speech Boundaries
- Runs Whisper (tiny.en or base.en) to transcribe Utterances
- Connects to the housekeeper server via WebSocket
- Plays back TTS audio responses via speaker (USB or Bluetooth)

## Hardware target

Raspberry Pi Zero 2W (~£15) + USB mic + USB/Bluetooth speaker.
Form factor similar to a Nest Mini. Cheap enough to place in multiple rooms.

## WebSocket interface (defined by housekeeper server)

### Registration handshake (device → server, on connect)
```json
{
  "type": "register",
  "id": "<stable-uuid-or-hostname>",
  "label": "hallway",
  "location": "downstairs hallway",
  "capabilities": ["mic", "speaker"]
}
```
`capabilities` is `["mic"]` or `["mic", "speaker"]`.

### Utterance message (device → server)
```json
{
  "type": "utterance",
  "nodeId": "<id>",
  "text": "housekeeper, turn off the kitchen light"
}
```

### TTS response (server → device)
```json
{
  "type": "tts",
  "audio": "<base64-encoded-wav-or-url>"
}
```
TBD: base64 inline vs URL to fetch. Depends on audio size.

## Listening Window

The server maintains a per-Voice-Node rolling transcript (Listening Window). The node does NOT need to implement this — just send every Utterance and let the server decide if it's a Directed Question.

## Open questions for the separate project

- **Whisper model size**: tiny.en (~75MB) vs base.en (~142MB) on Pi Zero 2W (512MB RAM). Tiny is safer; base gives better accuracy. Test both.
- **VAD approach**: webrtcvad (frame-accurate) vs energy threshold (simpler). webrtcvad preferred for accuracy but requires correct frame sizes (320/640/960 samples at 16kHz for the npm build; standard is 160/320/480).
- **Audio format for TTS playback**: decide whether server sends base64 WAV inline or a URL the device fetches. URL is cleaner for large audio files.
- **Reconnection**: device should reconnect with backoff if WebSocket drops. Re-send registration handshake on reconnect.
- **Multiple mic inputs**: a single node can theoretically have multiple mics (e.g. laptop with BT headset). Node picks the active input — server doesn't need to know about individual mics.
- **Listening Window scoping**: currently per-Voice-Node on the server. If you later want cross-node context (e.g. conversation started in kitchen, continued in hallway), this needs revisiting.
