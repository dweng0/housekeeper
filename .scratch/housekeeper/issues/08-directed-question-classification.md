Status: done

# Directed Question classification

## What to build

Receive a `PendingDirectedQuestion` (Listening Window payload), send it to the OpenAI-compatible LLM with a system prompt, and parse the response into structured intent JSON. The intent identifies the Trigger Device Label, Actuator Device Label, and any parameters (e.g. duration).

## Acceptance criteria

- [ ] `IntentClassifier` port interface implemented via OpenAI-compatible adapter (configurable endpoint)
- [ ] System prompt provides: list of known Device Labels, System Name, instruction to return structured JSON
- [ ] LLM response parsed into typed intent: `{ trigger: string, actuator: string, duration?: number, isDirectedQuestion: boolean }`
- [ ] `isDirectedQuestion: false` if LLM determines the utterance was not addressed to the system — no action taken
- [ ] Intent published as a `ClassifiedIntent` event for downstream consumers
- [ ] Errors (LLM unavailable, unparseable response) logged, no crash

## Blocked by

- Issue 07 (always-on STT + Listening Window)
