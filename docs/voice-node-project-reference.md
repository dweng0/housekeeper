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

## WebSocket interface

See [`voice-node-protocol.md`](./voice-node-protocol.md) — that document is the authoritative contract.

Key points for implementors:
- Send `register` within 5 seconds of connect or server closes connection
- `utterance` messages have no `nodeId` field — server infers from the WebSocket connection
- TTS responses are **raw binary WebSocket frames** (PCM, 22050 Hz, 16-bit signed LE) — not JSON, not base64

## Listening Window

Server maintains per-Voice-Node rolling transcript. Node does NOT implement this — just send every Utterance and let the server decide if it's a Directed Question.

## Open questions for the separate project

- **Whisper model size**: tiny.en (~75MB) vs base.en (~142MB) on Pi Zero 2W (512MB RAM). Tiny is safer; base gives better accuracy. Test both.
- **VAD approach**: webrtcvad (frame-accurate) vs energy threshold (simpler). webrtcvad preferred for accuracy but requires correct frame sizes (160/320/480 samples at 16kHz).
- **Reconnection**: reconnect with exponential backoff if WebSocket drops. Re-send `register` on reconnect using same `id`.
- **Multiple mic inputs**: node picks active input — server doesn't need to know about individual mics.
- **Listening Window scoping**: currently per-Voice-Node. Cross-node context (conversation started in kitchen, continued in hallway) needs revisiting if required.
