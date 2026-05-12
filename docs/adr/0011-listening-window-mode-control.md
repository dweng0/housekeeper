# ADR 0011 — Listening Window Mode Control via VoiceNodeHub Callbacks

## Status
Accepted

## Context

ADR 0009 specifies TTS Interruption via Stop-word Detection. Stop-words are only matched when the Listening Window operates in "stop-word-only" mode during TTS playback. The window must switch modes automatically to prevent ambient utterances from triggering new intents while the system is playing a response.

The question: where should mode control logic live? Three possible layers:
1. **In SpeechOutput** — the component rendering TTS (buffered audio)
2. **In VoiceAutomationService** — the orchestrator that knows about listening window lifecycle
3. **At VoiceNodeHub boundary** — the abstraction that owns TTS signal timing

Current implementation does mode switching in VoiceAutomationService via callbacks from VoiceNodeHub (onTtsStart/onTtsEnd). This pattern is implicit in the callback handlers and not documented.

## Decision

Mode control via listening window callbacks belongs at the **VoiceNodeHub boundary**, not within VoiceAutomationService or SpeechOutput.

`VoiceAutomationService` registers two optional callbacks on `VoiceNodeHub`:
- `onTtsStart(nodeId, token)` → `ListeningWindow.setMode("stop-word-only")`
- `onTtsEnd(nodeId, token)` → `ListeningWindow.setMode("normal")`

This ensures every TTS path (streamed or buffered, from any caller) automatically pauses ambient listening.

## Rationale

**Single Responsibility**: VoiceNodeHub owns the TTS start/end signal timing. It fires callbacks at the exact moments when listening should change. This responsibility is appropriately located at the hub boundary, not scattered across downstream callers.

**Decoupling**: SpeechOutput (a pure rendering engine) has no knowledge of listening window mode. Callers who use `speechOutput.speak()` directly don't need to know about mode switching. The contract is clean: "I render audio, the hub handles listening state."

**Completeness**: All TTS paths automatically respect the mode transition — buffered audio via `sendTts()`, streamed via `sendTtsStream()`, or future transport mechanisms. No path can leak system responses into the listening window.

## Tradeoff

`onTtsEnd` fires when the hub signals stream completion, which may be ~50–200ms before device playback actually finishes. During this window, ambient listening is briefly enabled. In practice, this is acceptable because:
- The window is short and immediately follows TTS (no user speech expected in that gap)
- Worst case: an ambient utterance triggers but the system has context ("we just played audio") to filter it
- Alternative (waiting for device acknowledgment) would require protocol changes and cross-device synchronization

## Alternatives considered

**Mode control in VoiceAutomationService** — service orchestrates mode switches explicitly. Problem: every call site that invokes `voiceNodeHub.sendTts()` or `speechOutput.speak()` must know to switch modes. Leaks responsibility, error-prone, hard to test.

**Mode control in SpeechOutput** — renderer manages its own listening impact. Problem: couples rendering engine to application concerns (listening window). SpeechOutput becomes responsible for side effects outside its domain. Breaks abstraction.

**Device protocol changes** — extend Voice Node protocol so device explicitly signals "playback finished" rather than inferring from stream end. Problem: unnecessary complexity, requires Pi node and device firmware changes. Current ~50–200ms window is acceptable without this.

## Consequences

- Listening Window mode transitions are driven by VoiceNodeHub callbacks (onTtsStart/onTtsEnd), not explicit calls from VoiceAutomationService
- All TTS transports (buffered and streamed) automatically respect listening window mode without caller awareness
- VoiceAutomationService.start() registers these callbacks during initialization
- Callback implementation remains in voice-automation-service.ts; no refactoring needed
- Documentation clarifies this architectural intent so future changes respect the pattern
