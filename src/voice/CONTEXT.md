# Voice Context

Handles always-on speech transcription, detects Directed Questions, and dispatches classified intent to the Automation and Memory contexts.

## Language

**Directed Question**:
An utterance that contains the System Name and is interpreted as addressed to the system. The name may appear anywhere in the sentence.
_Avoid_: wake word, command, voice command

**System Name**:
The configurable name the household uses to address the AI (e.g. "Jarvis"). Detected by text scan of the Listening Window.
_Avoid_: wake word, hotword

**Utterance**:
A single continuous spoken sentence or phrase, bounded by a Speech Boundary.
_Avoid_: command, speech, input

**Listening Window**:
The fixed-duration rolling transcript maintained by always-on STT. When the System Name is detected within it, the system enters capture mode and waits for a Speech Boundary before dispatching the full window for classification.
_Avoid_: context window, audio buffer, transcript buffer

**Speech Boundary**:
The point of detected silence (via VAD debounce, ~700ms–1s) that closes the Listening Window and triggers dispatch to the directed-question classifier. Resets if new speech is detected before the threshold.
_Avoid_: end of speech, silence detection, cutoff

## Relationships

- A **Listening Window** contains zero or more **Utterances**
- A **Directed Question** is one **Utterance** that references the **System Name**
- A **Speech Boundary** closes the **Listening Window** and triggers classification
