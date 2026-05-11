# ADR 0006 — Pre-rendered Response Audio Cache

## Status
Proposed

## Context
Every `device-control` Directed Question triggers two sequential operations: an LLM call (intent classification + Confirmation Response text) and a piper render (text → PCM). Both add latency before audio plays. For common commands the Confirmation Response text is predictable — "the hallway light is now on" doesn't need to be generated fresh each time.

## Decision
Introduce a Response Audio Cache: a set of pre-rendered WAV files for every registered `{deviceLabel, command}` pair, plus a shared pool of generic not-found variants. The cache is:
- Built incrementally at startup (missing entries only) using LLM-generated text variants rendered via piper
- Extended immediately when a new device is registered
- Fully rebuilt on demand via a dashboard action
- Stored at `data/response-cache/` (gitignored)

On a `device-control` outcome, `VoiceAutomationService` consults a `ResponseAudioCache` port before falling through to live TTS. Cache hits skip both the LLM response-generation step and the piper render entirely.

## Alternatives considered
**Live TTS only (status quo)** — no staleness risk, no build step. But every response incurs LLM + piper latency, making device commands feel sluggish.

**In-memory cache** — fast to build, no disk I/O. Lost on every restart — defeats the purpose of avoiding piper at runtime.

**Cache by raw utterance** — more intuitive key. Rejected because utterances are unbounded; the LLM already normalises them to `{deviceLabel, command}`.

## Consequences
- Device-control responses play significantly faster on cache hit
- Cache can drift from the persona if the persona is updated without a rebuild (dashboard warns)
- Variant count (default 3) is configurable; higher values trade disk space for more variation
- Queries and non-device-control intents remain fully live — out of scope for this cache
