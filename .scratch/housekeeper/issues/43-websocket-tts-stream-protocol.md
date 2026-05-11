Status: needs-triage

# 43 — WebSocket TTS Stream Protocol

## What to build

Add streaming TTS framing to the WebSocket Voice Node protocol on both server and Pi. The server gains a `sendTtsStream(nodeId, AsyncIterable<Buffer>)` method on `VoiceNodeHub`. The existing `sendTts(nodeId, Buffer)` is reimplemented to route through the same framing, so the Pi handles one protocol for all audio.

Wire framing on the server (`websocket-voice-node-hub.ts`):
- `tts_stream_start` — JSON frame sent before any audio; closes and discards any in-progress stream on the Pi
- one or more raw binary PCM frames — audio chunks
- `tts_stream_end` — JSON frame sent after last chunk

Wire on the Pi (`voicenode`):
- `tts_stream_start` — close any in-progress `sounddevice.OutputStream`, open a fresh persistent one
- binary frame (while stream open) — write chunk to the open stream
- `tts_stream_end` — close the stream

`SounddeviceAudioAdapter` gains a streaming mode: `open_stream()`, `write_chunk(bytes)`, `close_stream()`. The existing `play(bytes)` can remain for non-streaming callers (or be reimplemented on top of the streaming primitives).

Also update `ports.ts` to add `sendTtsStream` to the `VoiceNodeHub` interface.

## Acceptance criteria

- [ ] `VoiceNodeHub` interface in `ports.ts` has `sendTtsStream(nodeId: string, chunks: AsyncIterable<Buffer>): Promise<void>`
- [ ] `WebSocketVoiceNodeHub.sendTts(Buffer)` sends `tts_stream_start` → binary frame → `tts_stream_end`
- [ ] `WebSocketVoiceNodeHub.sendTtsStream(AsyncIterable<Buffer>)` sends `tts_stream_start` → one binary frame per chunk → `tts_stream_end`
- [ ] Pi `_receive_loop` handles `tts_stream_start` (opens persistent stream, interrupts any current), binary frames (writes to open stream), `tts_stream_end` (closes stream)
- [ ] `SounddeviceAudioAdapter` supports persistent open stream with chunk writes
- [ ] Existing single-response audio plays correctly end-to-end (backward-compatible single-chunk path)
- [ ] Tests updated on both server and Pi sides

## Blocked by

None — can start immediately.
