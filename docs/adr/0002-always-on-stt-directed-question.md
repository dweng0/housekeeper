# Always-on STT with Directed Question detection instead of wake-word

The system runs STT continuously, maintaining a rolling Listening Window. When the System Name appears anywhere in the transcript, it enters capture mode and waits for a Speech Boundary before classifying intent. This replaces the conventional wake-word model (keyword detected first, then STT starts).

## Considered options

- **Wake-word detector** (e.g. Porcupine, openWakeWord) — low CPU, triggers STT only after keyword. Requires the name to come first; misses "...what does Jarvis think about..." patterns.
- **Always-on STT + name scan** (chosen) — captures speech before and after the System Name, enabling natural sentence structures where the name appears anywhere. Higher CPU cost but more natural interaction.

## Consequences

STT runs continuously. This has non-trivial CPU and power implications on low-powered hardware. The Speech Boundary debounce (~700ms–1s) must be tuned to feel natural — too short clips trailing speech, too long makes responses feel slow.
