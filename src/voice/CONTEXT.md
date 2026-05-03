# Voice Context

Handles always-on speech transcription from distributed Voice Nodes, detects Directed Questions, and dispatches classified intent to the Automation and Memory contexts. Routes TTS responses back to the originating Voice Node (or the default output node).

## Language

**Voice Node**:
A Raspberry Pi-based device registered with the server that provides audio input, output, or both. Connects to the server via WebSocket. Has a label, a location, and declared capabilities.
_Avoid_: edge device, smart speaker, microphone, client

**Capabilities**:
The audio roles a Voice Node declares on registration: `mic` (input only) or `mic+speaker` (input and output).
_Avoid_: type, mode, features

**Location**:
A free-text string describing where in the house a Voice Node is placed (e.g. `"hallway"`, `"upstairs bedroom"`). Used by the LLM to resolve implicit spatial references in Directed Questions.
_Avoid_: room, zone, area

**Default Output Node**:
The globally configured Voice Node used as fallback for TTS responses when the originating Voice Node has no speaker capability. Configured system-wide via the dashboard. If offline, the response is logged and dropped.
_Avoid_: fallback speaker, default device

**Directed Question**:
An utterance that contains the System Name and is interpreted as addressed to the system. The name may appear anywhere in the sentence.
_Avoid_: wake word, command, voice command

**System Name**:
The configurable name the household uses to address the AI (e.g. "housekeeper"). Detected by text scan of the Listening Window.
_Avoid_: wake word, hotword

**Utterance**:
A single continuous spoken sentence or phrase, bounded by a Speech Boundary. Transcribed on the Voice Node and sent as text to the server.
_Avoid_: command, speech, input

**Listening Window**:
A per-Voice-Node rolling transcript of recent Utterances. When the System Name is detected within it, the full window is dispatched for classification.
_Avoid_: context window, audio buffer, transcript buffer

**Speech Boundary**:
The point of detected silence (via VAD debounce, ~700ms–1s) that closes an Utterance on the Voice Node. Handled on the Voice Node, not the server.
_Avoid_: end of speech, silence detection, cutoff

## Relationships

- A **Voice Node** sends zero or more **Utterances** to the server over WebSocket
- A **Listening Window** is maintained per **Voice Node** on the server
- A **Directed Question** is one **Utterance** that references the **System Name**
- A TTS response routes to the originating **Voice Node** if it has speaker capability; otherwise routes to the **Default Output Node**
- Multiple **Voice Nodes** may be connected simultaneously

## Registration

On WebSocket connect, a Voice Node sends a handshake containing:
- `id` — stable identifier (e.g. hostname or UUID, persisted on device)
- `label` — human-readable name (e.g. `"hallway"`)
- `location` — free-text location string (e.g. `"downstairs hallway"`)
- `capabilities` — `["mic"]` or `["mic", "speaker"]`

If unregistered, the node surfaces in the dashboard for confirmation. If already registered, it reconnects by ID.
