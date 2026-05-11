# Housekeeper

An AI-centric smart home system. Natural language (voice) is the primary interface for creating and managing home automations. AI interprets intent at authoring time; a deterministic automation engine executes rules at runtime.

## Language

### Voice & Intent

**Directed Question**:
An utterance that contains the system name and is interpreted as addressed to the system. The name may appear anywhere in the sentence.
_Avoid_: wake word, command, voice command

**System Name**:
The configurable name the household uses to address the AI (e.g. "Jarvis"). Presence of the system name in a transcription triggers directed-question classification.
_Avoid_: wake word, hotword

**Utterance**:
A single continuous spoken sentence or phrase, bounded by a Speech Boundary.
_Avoid_: command, speech, input

**Listening Window**:
The fixed-duration rolling transcript maintained by always-on STT. When the system name is detected within it, the system enters capture mode and waits for a Speech Boundary before dispatching the full window for classification. During TTS playback, the Listening Window switches to "stop-word only" mode: ambient utterances are ignored, only Stop-word keywords are matched. The window resumes normal operation after TTS ends.
_Avoid_: context window, audio buffer, transcript buffer

**Speech Boundary**:
The point of detected silence (via VAD debounce, ~700ms–1s) that closes the Listening Window and triggers dispatch to the directed-question classifier. Resets if new speech is detected before the threshold.
_Avoid_: end of speech, silence detection, cutoff

**Stop-word**:
An utterance keyword (e.g. "wait", "stop", "hold on") spoken during device-control or create-automation TTS playback that triggers the Interruption flow. Detected via keyword matching (not LLM) while the Listening Window is in "stop-word only" mode. Does not interrupt query responses.
_Avoid_: interrupt word, cancel keyword

**Interruption Flow**:
The sequence triggered by a Stop-word during TTS playback: (1) pause device-control TTS stream, (2) play cached Stop Confirmation response, (3) listen for 3 seconds for explicit yes/no intent, (4) if "no" or timeout, replay original stream; if "yes", discard stream. Stop-word confirmations are not logged as conversation turns.
_Avoid_: cancellation flow, stop flow

### Devices

**Device**:
An MQTT-connected entity with a human-readable label. May be a sensor or an actuator.
_Avoid_: thing, node, endpoint

**Sensor**:
A Device that emits state events (e.g. motion detected, door opened).
_Avoid_: trigger, input device

**Actuator**:
A Device that receives commands (e.g. light switch, thermostat).
_Avoid_: output device, switch (too specific)

**Label**:
The human-readable name assigned to a Device (e.g. "Hallway sensor"). Used by the AI to resolve natural language references to specific MQTT topics.
_Avoid_: name, alias, friendly name

**Resident**:
A named person in the household whose preferences and history are stored as a scoped memory context in mem0. Identified initially by named session ("Jarvis, this is Jay"); voice fingerprinting is a planned future capability.
_Avoid_: user, person, occupant

**Auto-discovery**:
A toggleable mode in which the system watches the MQTT broker for new topics and surfaces unregistered Devices in the dashboard for labelling. Disabled for security when only known Devices should be visible.
_Avoid_: device scan, discovery mode

### Automations

**Automation**:
A persisted rule that maps a Trigger to one or more Actions. Executed by the automation engine without AI involvement.
_Avoid_: rule, scene, script

**Trigger**:
The condition that activates an Automation (e.g. a Sensor emitting a specific event).
_Avoid_: condition, event, when-clause

**Action**:
A command sent to an Actuator when an Automation fires.
_Avoid_: effect, then-clause, command

## Relationships

- A **Device** has exactly one **Label**
- An **Automation** has one **Trigger** and one or more **Actions**
- A **Trigger** references a **Sensor** (by Label)
- An **Action** references an **Actuator** (by Label)
- A **Directed Question** is scoped to the active **Resident** session, or falls back to household-level memory when no Resident is identified
- A **Directed Question** may result in a new **Automation** being created
- A **Directed Question** that receives a spoken response opens a **Conversation Context** on the originating Voice Node
- A **Conversation Context** accepts **Follow-up Utterances** without requiring the System Name
- A **Device** must be registered (have a **Label**) before it can be referenced in an **Automation**
- **Auto-discovery** can be disabled for security; when off, Devices must be registered manually via dashboard or voice

## Tech stack

- **Server**: Node.js (LTS) + TypeScript + Express
- **Dashboard**: React + Vite + shadcn/ui (Tailwind + Radix), served as static files from Express
- **Automation storage**: JSON files
- **MQTT broker**: Mosquitto (local in dev, external in prod)
- **LLM**: OpenAI-compatible endpoint (Ollama in dev)
- **LLM memory**: mem0 (TypeScript SDK)
- **Dev environment**: devenv.sh — `devenv shell` for toolchain, `devenv up` for services; `devenv.local.nix` (gitignored) overrides env vars for local services

## Ports (hexagonal architecture)

| Port | Direction | Default adapter |
|------|-----------|----------------|
| `SpeechInput` | inbound | microphone + STT |
| `SpeechOutput` | outbound | Piper TTS |
| `IntentClassifier` | inbound | OpenAI-compatible LLM |
| `AutomationRepository` | outbound | `automations.json` |
| `DeviceRepository` | outbound | `devices.json` |
| `DeviceGateway` | outbound | MQTT (Mosquitto) |
| `MemoryStore` | outbound | mem0 |
| `HttpApi` | inbound | Express |
| `DashboardUI` | outbound | React + Vite + shadcn/ui |

## Example dialogue

> **Dev:** "When the user says 'Jarvis, when the front door opens, turn on the porch light for 10 seconds' — what gets created?"
> **Domain expert:** "The AI resolves 'front door' to the Sensor with that Label and 'porch light' to the Actuator with that Label, then creates an Automation with a Trigger on the front door Sensor and an Action on the porch light Actuator."
> **Dev:** "Does Jarvis stay involved after that?"
> **Domain expert:** "No — the Automation engine runs the rule directly. AI only ran at authoring time."
