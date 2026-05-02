Status: ready-for-human

# Always-on STT + Listening Window

## What to build

Microphone input feeds always-on STT. A rolling Listening Window holds the recent transcript. When the System Name is detected, the system enters capture mode and waits for a Speech Boundary (VAD debounce ~700ms) before dispatching the full Listening Window for classification.

## Acceptance criteria

- [x] STT runs continuously from microphone input (WhisperCppAdapter spawns whisper-stream with --step 0)
- [x] Listening Window maintains a rolling transcript (configurable duration, default 15s) (makeListeningWindow implemented)
- [x] System Name is configurable (env var, default "Jarvis") (SYSTEM_NAME env var in devenv.nix)
- [x] System Name detection (case-insensitive) in transcript triggers capture mode (ListeningWindow.addUtterance checks)
- [x] Speech Boundary detected via VAD silence debounce (~700ms, configurable) (whisper-stream --vad-min-silence-duration-ms)
- [x] On Speech Boundary: full Listening Window dispatched (onDirectedQuestion callback)
- [x] `SpeechInput` port interface satisfied by the chosen STT adapter (WhisperCppAdapter implements SpeechInput)

## Blocked by

- Issue 01 (project scaffold) - DONE
- Issue 02 (STT engine selection) - DONE

## Implementation notes

- WhisperCppAdapter spawns `whisper-stream` with Silero VAD for speech boundary detection
- VAD handles the 700ms silence debounce at the STT level
- ListeningWindow fires immediately when System Name detected in utterance
- Full window (including prior utterances) is dispatched via onDirectedQuestion callback
- Silero VAD model downloaded via scripts/download-silero-vad.sh
- Models stored in data/vad-models/ and data/whisper-models/

## Testing

Run `devenv up` to start the system. The STT will begin listening immediately. Say something containing "Jarvis" to trigger the directed question detection (logged to console).
