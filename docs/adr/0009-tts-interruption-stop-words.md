# ADR 0009 — TTS Interruption via Stop-word Detection

## Status
Accepted

## Context

During device-control or create-automation responses, the system streams TTS audio to the Voice Node. While audio is playing, the always-on STT continues to listen. If the user speaks (or if speech-to-text mishears the system's own audio output), incoming utterances are captured as ambient speech and may trigger new intents, leading to overlapping responses or confused conversation state.

Example: User says "turn on the bedroom light" → system plays confirmation → while audio is streaming, user says "wait" (stop-word) → STT hears "bedroom line" (misheard) → system classifies as new intent → multiple responses queued.

## Decision

Implement TTS Interruption: when a Stop-word is detected during device-control or create-automation playback, pause the stream, play a cached confirmation response, and await explicit yes/no intent within 3 seconds. If "no" or timeout, replay the original stream; if "yes", discard it.

### Stop-word detection
- **Trigger**: only on device-control and create-automation TTS (not queries)
- **Detection**: keyword matching (not LLM classification) on hard-coded list: "wait", "stop", "hold on", "cancel", "no", "nope", "never mind"
- **Matching**: whole-word, case-insensitive
- **Listening mode**: while TTS streams, close ambient listening window; only match Stop-words

### Confirmation flow
1. `VoiceAutomationService` calls `voiceNodeHub.sendTtsStream(nodeId, chunks)`
2. `VoiceNodeHub` buffers stream chunks in short-lived cache (`{nodeId}:{streamToken}`, ~30s TTL)
3. While stream plays: Listening Window enters "stop-word only" mode
4. If Stop-word detected: cancel in-flight stream, play cached confirmation (randomly selected from 10 pre-rendered variants)
5. Listen for 3 seconds for explicit yes/no response
6. If "no" or timeout: replay original stream from cache; if "yes": discard
7. After playback ends: resume normal Listening Window operation

### Cache strategy
- Response Audio Cache builds at startup: add `__stop_confirmation__` key with 10 variants
- Variants pre-rendered using LLM + TTS (same as device-control responses)
- Examples: "Did you want me to stop?", "Should I stop what I'm doing?", "Do you want me to cancel that?"
- Stream chunk cache in `VoiceNodeHub`: transient, expires after 30s; survives one replay

### Conversation context
- Stop-word confirmations are not logged as turns in conversation context
- Original utterance + original response logged once (whether or not interrupted)
- If replayed, context remains unchanged
- Context reset only on explicit "yes" to interruption

## Alternatives considered

**Acoustic echo cancellation on Pi** — avoid mishearing system's own audio. Requires hardware changes and tuning per device; fragile across different speaker/mic setups.

**Mute mic during TTS** — simple, but cannot detect Stop-words at all. Breaks interactivity.

**LLM-based stop-word detection** — more flexible, handles "actually stop this" etc. But adds latency (LLM round-trip) when we need sub-100ms responsiveness. Overkill for ~10 keywords.

**Queue all TTS responses sequentially** — avoids concurrent streams. But Stop-word confirmations must play immediately, defeating the purpose.

## Consequences

- Pi (`voicenode` project) must implement stop-word detection on incoming utterances during `tts_stream_start` → `tts_stream_end` window
- `VoiceNodeHub.sendTtsStream()` now buffers chunks and tracks stream tokens
- Response Audio Cache gains `__stop_confirmation__` key; build adds ~10 WAV files at startup
- `VoiceAutomationService` must orchestrate mode switches on Listening Window (pause ambient, enable stop-words)
- Edge case: if user says Stop-word multiple times during stream replay, TTS replays repeatedly (cheap, acceptable)
- Conversation context unaffected by interruptions; simpler logging model
