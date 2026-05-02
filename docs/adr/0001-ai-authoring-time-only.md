# AI runs at authoring time only, not at automation runtime

When a user creates an Automation via a Directed Question, the LLM interprets intent and produces structured output once. After that, the automation engine executes the resulting rule deterministically against MQTT — no LLM is invoked when a Sensor fires.

## Considered options

- **Runtime AI** — LLM reasons about each sensor event and decides what to do. More flexible, but high latency, requires LLM availability for the home to function, and makes behaviour unpredictable.
- **Authoring-time AI only** (chosen) — LLM runs once to create the rule; deterministic engine runs it. Fast, reliable, works when LLM is offline.

## Consequences

The automation engine has no LLM calls by design. If a future engineer adds LLM calls to the execution path, that contradicts this decision and should be treated as a deliberate architectural change, not a feature.
