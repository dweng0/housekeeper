Status: needs-triage

# 45 — Cast Progressive HTTP Streaming

## What to build

Enable Cast Nodes to begin playback before Kokoro has finished rendering. The Express audio file server registers a streaming HTTP route immediately (before any chunks arrive), sends the URL to the Cast device, then pipes PCM chunks into the response as they arrive from Kokoro.

Changes:

**`ports.ts`** — `AudioFileServer` gains:
```ts
serveStream(chunks: AsyncIterable<Buffer>): Promise<{ url: string; cleanup: () => void }>
```

**`express-audio-file-server.ts`** — `serveStream` creates a `PassThrough` stream per token, registers the route synchronously (URL available before chunks begin), writes an infinite-size WAV header (`0xFFFFFFFF` data length, 24kHz mono 16-bit) as the first bytes, then pipes PCM chunks into the `PassThrough` as they arrive. Route is removed on `cleanup()`.

**`cast-voice-node-hub.ts`** — `sendTtsStream(nodeId, chunks)` calls `audioFileServer.serveStream(chunks)`, then immediately calls `client.playUrl(url)`. Cast device begins fetching and playing progressively.

The existing `sendTts(nodeId, Buffer)` path on Cast hub is unchanged — cache hits still use `audioFileServer.serve(buffer)`.

## Acceptance criteria

- [ ] `AudioFileServer` interface in `ports.ts` has `serveStream(chunks: AsyncIterable<Buffer>): Promise<{ url: string; cleanup: () => void }>`
- [ ] `ExpressAudioFileServer.serveStream` registers route before returning URL
- [ ] WAV header with `0xFFFFFFFF` data size is written before first PCM chunk
- [ ] Long TTS response begins playing on Cast Node before Kokoro has finished rendering
- [ ] Route is cleaned up after playback (30s timeout, same as current)
- [ ] Existing `serve(Buffer)` / cache-hit path on Cast hub is unchanged

## Blocked by

- `43-websocket-tts-stream-protocol`
- `44-kokoro-live-streaming`
