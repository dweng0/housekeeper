Status: needs-triage

# 44 — Kokoro Live Streaming

## What to build

Change `OpenAiTtsAdapter.speak()` to request Kokoro with `stream: true` and `response_format: "pcm"`, then iterate the response body as an `AsyncIterable<Buffer>` and pass it directly to `hub.sendTtsStream()`. The Pi begins playing the first sentence while the server is still receiving subsequent chunks from Kokoro.

Also update `OpenAiTtsAdapter.render()` (used internally) and `openai-tts-renderer.ts` (used by the Response Audio Cache builder) — these remain non-streaming (`response_format: "pcm"`, no `stream` flag) since the cache builder needs a complete buffer.

## Acceptance criteria

- [ ] `OpenAiTtsAdapter.speak()` calls Kokoro with `{"stream": true, "response_format": "pcm"}` and passes the response body chunks to `hub.sendTtsStream()`
- [ ] `openai-tts-renderer.ts` (`TtsRenderer` port, used by cache builder) is unchanged — still returns `Promise<Buffer>`
- [ ] Long TTS response (3+ sentences) begins playing on Pi before Kokoro has finished rendering
- [ ] Short responses (single chunk) continue to work correctly
- [ ] Error from Kokoro mid-stream is logged and stream is closed cleanly

## Blocked by

- `43-websocket-tts-stream-protocol`
