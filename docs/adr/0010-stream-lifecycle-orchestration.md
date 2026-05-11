# ADR 0010 — TTS Stream Lifecycle Orchestration

## Status
Proposed (from grill session on issue #59)

## Context

ADR 0009 specifies TTS interruption via stop-word detection. Implementation requires:
- Tracking in-flight stream tokens
- Mode switching on ListeningWindow (normal ↔ stop-word-only)
- Stream replay on "no" response
- Discarding streams on "yes" response

Currently, `VoiceAutomationService` calls `voiceNodeHub.sendTtsStream()` directly from within ambient utterance handlers, but doesn't:
- Capture returned stream tokens
- Switch ListeningWindow modes before/after streaming
- Manage stream state for replay

## Decision

Expose `sendTtsStream(nodeId: string, chunks: AsyncIterable<Buffer>)` as a public method on `VoiceAutomationService`. This wrapper:

1. **Calls** `voiceNodeHub.sendTtsStream(nodeId, chunks)` and captures token
2. **Switches mode** to "stop-word-only" on ListeningWindow before stream starts
3. **Tracks token** in `inFlightStreams` map for duration of stream
4. **Returns token** to caller for use in stop-word response handlers
5. **Cleans up** (switches back to "normal" mode) after stream completes

### Token lifecycle

- Token stored in `inFlightStreams` while streaming
- On stop-word interruption: token remains available for replay
- On "no" response: fetch stream buffer via `voiceNodeHub.getStreamBuffer(nodeId, token)`
- On "yes" response: discard token, ignore remaining chunks
- On cache expiry: log warning, fallback to unknown intent (acceptable per spec)

### Mode switching

- **Before stream**: `setMode("stop-word-only")` to suppress ambient utterances
- **After confirmation playback** (during 3-sec yes/no window): `setMode("normal")`
- **After interruption resolved** (replay completes or yes dispatched): `setMode("normal")`

### Stream cancellation

No explicit cancel method needed. Discarding token from `inFlightStreams` is sufficient; incoming utterances filtered by "stop-word-only" mode. Device continues playback naturally; system ignores audio input until mode resets.

## Alternatives considered

**Internal helper** — wrap sendTtsStream internally, only use from ambient handlers. Simpler API surface, but harder to test and extend for other response types.

**Modify VoiceNodeHub.sendTtsStream signature** — return completion promise or callback. Cleaner interface, but harder to reverse (affects all callers, Pi node protocol).

**Buffer chunks eagerly** — capture all chunks during streaming for replay. More memory overhead; requires tracking stream completion which isn't signaled by current interface.

## Consequences

- `VoiceAutomationService` gains public `sendTtsStream()` method
- Callers can migrate from direct `voiceNodeHub.sendTtsStream()` calls to wrapper when they need mode switching + token tracking
- `inFlightStreams` map grows with each stream; entries cleaned up on completion or discard
- Mode switching is now explicit, testable surface
- Stream replay depends on cache TTL (~30s per ADR 0009); edge case handled by fallback to unknown intent
