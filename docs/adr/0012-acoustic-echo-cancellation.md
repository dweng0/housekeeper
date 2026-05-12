# ADR 0012 — Acoustic Echo Cancellation replaces Listening Window Mode Control

## Status
Accepted

## Context

ADR 0011 specified listening window mode control: switching the window to "stop-word-only" mode during TTS playback to prevent ambient utterances from triggering new intents while the system responds.

This pattern works when a single device both plays the response and listens for stop-words. But the system now supports mic-only voice nodes (nodes with microphones but no speakers). When a mic-only node is in the same room as a speaker node playing TTS:

- The speaker broadcasts audio to all mic devices (TTS can originate from any device)
- Mic-only nodes hear the remote speaker's output
- Their microphone captures the TTS audio as ambient sound
- Mode control on the mic-only node's listening window can't gate what it hears — the audio is coming from a different device, played by a different hub

Mode control only works when the same node that originates TTS also controls its own listening window. With multi-node distributed audio, this assumption breaks.

The question: how to prevent TTS playback from echoing back as new utterances detected on mic nodes?

## Decision

Server broadcasts TTS reference audio to all mic-capable devices when a response begins. Each device performs local Acoustic Echo Cancellation (AEC):

1. **Server signals TTS start** — VoiceAutomationService begins rendering TTS via `speechOutput.speak()`
2. **Reference audio broadcast** — Each chunk of rendered audio is sent to all mic-capable devices with an `isAecReference: true` flag
3. **Device-side cancellation** — Each mic device buffers the reference audio (indexed by timestamp) and performs local echo cancellation: subtracting the known reference from microphone input
4. **Residual audio sent back** — Only the processed (echo-cancelled) audio returns to the server for STT
5. **Listening window operates normally** — The window stays in normal mode during TTS; stop-word detection works naturally on residual audio

## Rationale

**Root cause**: Echo occurs at the acoustic level (speaker output physically present in the mic). Gating the listening window doesn't prevent the acoustic phenomenon; it only ignores the input. With AEC, we remove the phenomenon itself.

**Scales with device count**: No device-to-device coordination required. Each mic performs local cancellation independently. Adding more mic nodes doesn't increase complexity — broadcast is 1:N regardless of N.

**Works for any mic that hears the speaker**: If a mic-only node is in the same room as a speaker playing TTS, that node will capture TTS in its microphone. AEC handles this automatically because it receives the reference audio. Mode control would not (the originating device controls its own mode, not the mic-only device's).

**Listening window stays responsive**: Stop-words are detected naturally during TTS on residual (echo-cancelled) audio. Users can still interrupt responses without the system switching modes on them.

## Tradeoff

**Client-side CPU cost**: Pi nodes must implement WebRTC AEC (or equivalent), which adds compute load. Acceptable on modern Pi (4B+) — AEC is ~5–10% CPU for real-time audio processing. Earlier Pi models may struggle; this is an acceptable version constraint.

**Timestamp synchronization**: Reference audio must be timestamped and matched to mic input by timestamp. Clock drift between server and devices must be small (~10ms tolerance for safe cancellation). This adds complexity to device firmware but is necessary for correctness.

**Higher protocol traffic**: Mic-only devices receive all TTS reference audio, even if they won't use it (e.g., in a multi-room scenario where a device is isolated). Broadcast to all is simpler than selective delivery. Acceptable trade for simplicity.

## Alternatives considered

**Listening Window mode control (ADR 0011 pattern)** — Gate the window on all devices, not just the originating node.
- Problem: Requires coordination across all devices and all nodes to switch modes together. How does a mic-only node know that a *different* device started TTS?
- Problem: Doesn't solve the problem; it only hides the symptom. Ambient echo is still captured in the microphone; we just throw it away. If users speak during the window close, they don't get heard (bad UX). If the window is only *partly* closed, echo still leaks through.
- **Rejected**: Doesn't work architecturally for distributed audio.

**Silence/pausing the microphone during TTS** — Tell all mics to stop recording when TTS plays.
- Problem: Too aggressive. Users can't interrupt if the mic is closed. Breaks the stop-word interrupt flow.
- Problem: Requires protocol changes to pause/resume mics dynamically. More complex than AEC.
- **Rejected**: Breaks user experience.

**Server-side echo suppression** — Process all incoming mic audio on the server to remove TTS echoes.
- Problem: Server doesn't know what the *acoustic* echo looks like on each device. Echo is device-specific (room acoustics, mic placement, speaker distance). Server-side suppression is generic and would over-suppress or under-suppress.
- Problem: Doesn't solve the root cause (acoustic phenomenon), just attempts to mask it.
- **Rejected**: Inferior to local AEC.

## Consequences

- **VoiceAutomationService** broadcasts TTS reference audio to all mic devices when `speechOutput.speak()` is called. Each chunk is streamed to each device with `isAecReference: true` flag.
- **SpeechOutput interface** gains optional `onChunk?: (chunk: Buffer) => void` parameter to support chunk-by-chunk audio delivery (required for real-time reference broadcast).
- **VoiceNodeHub** receives reference audio frames for all mic devices and forwards them with the `isAecReference` flag set.
- **Device protocol** includes TTS reference frames with timestamp and `isAecReference` flag so devices can buffer and match against live microphone input.
- **Listening Window** no longer switches modes. It stays in normal mode during TTS. `onTtsStart` and `onTtsEnd` callbacks (from ADR 0011) are removed.
- **Stop-word detection** continues to work during TTS because residual (echo-cancelled) audio is processed normally.
- **Device firmware** must implement WebRTC AEC (or equivalent) to perform local echo cancellation. This is a new device capability requirement.
