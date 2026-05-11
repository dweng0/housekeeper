# ADR 0008 — Streaming TTS Delivery via Kokoro

## Status
Accepted

## Context
Long TTS responses (multi-sentence) have noticeable latency: the server waits for the full render to complete before sending any audio to the Voice Node. Kokoro (the current TTS server) supports streaming — it yields one PCM chunk per sentence as it renders. Capturing this lets playback begin on the first sentence while subsequent sentences are still being synthesised.

Two transports must be handled differently: WebSocket Nodes (Pi) receive audio directly over the WebSocket connection; Cast Nodes fetch audio via HTTP URL.

The Response Audio Cache stores pre-rendered complete buffers (cache hits). Cache hits are already fast and don't benefit from streaming.

## Decision

### Port shape
`VoiceNodeHub` gains a second method alongside the existing `sendTts`:

```ts
sendTts(nodeId: string, audio: Buffer): Promise<void>         // cache hits
sendTtsStream(nodeId: string, chunks: AsyncIterable<Buffer>): Promise<void>  // live Kokoro
```

`sendTts` on WebSocket hub is implemented by wrapping the buffer as a single-chunk stream and routing through the same framing protocol. One protocol on the wire; two call sites in TypeScript.

### WebSocket framing protocol
```
{"type": "tts_stream_start"}   ← JSON frame
<binary PCM chunk>              ← one or more binary frames
<binary PCM chunk>
{"type": "tts_stream_end"}     ← JSON frame
```

On the Pi: `tts_stream_start` closes any in-progress `OutputStream` and opens a fresh persistent one. Subsequent binary frames write into it. `tts_stream_end` closes it. This preserves interrupt semantics (new response cuts off old one) while enabling gapless chunk-to-chunk playback.

### Cast progressive streaming
`AudioFileServer` gains a `serveStream(chunks: AsyncIterable<Buffer>)` method. The Express route is registered synchronously (URL available immediately). When the Cast device fetches the URL, the response writes a WAV header with `0xFFFFFFFF` data length, then pipes raw PCM chunks as they arrive. Cast device begins progressive playback before Kokoro has finished rendering.

### Kokoro request format
`response_format: "pcm"`, `stream: true`. Raw 16-bit PCM at 24 kHz mono. WAV header is prepended server-side only for Cast (infinite-size variant).

### Piper removed
`PiperTtsAdapter`, `PiperDaemonTtsRenderer`, and related subprocess machinery are deleted. Kokoro is the sole TTS renderer.

## Alternatives considered

**Buffer full stream server-side, send one frame** — no protocol change on Pi or Cast, but zero latency benefit. Defeats the purpose.

**Single `sendTtsStream` port only** — cleaner interface, but cache hits (complete buffers) would be wrapped unnecessarily. Dual port keeps the fast path explicit.

**Binary opcodes for framing** — more compact but breaks the existing mixed JSON/binary convention and requires new parsing on the Pi.

## Consequences

- Pi (`voicenode` project) must implement `tts_stream_start` / `tts_stream_end` message handling and switch from per-call `OutputStream` to a persistent open stream.
- `AudioFileServer` port gains `serveStream`. Express implementation registers a `PassThrough` route per token before returning the URL.
- Cache hits remain single-buffer sends; no cache changes needed.
- Piper model files and download scripts can be removed.
- `TtsRenderer` port (used by cache builder) is unchanged — still returns `Promise<Buffer>`.
