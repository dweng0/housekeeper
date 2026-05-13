# ADR 0014 — Chitchat Follow-ups via the `query` Intent Type

## Status
Accepted

## Context

Once a Conversation Context is open (ADR 0007), Follow-up Utterances are routed to the Intent Classifier without requiring the System Name. Many follow-ups in natural dialogue are conversational rather than actionable: "I had a long day", "what do you think?", "tell me a joke". These do not map to `device-control`, `create-automation`, or `set-resident`.

Today the classifier handles such utterances inconsistently:

- It frequently returns prose ("Sounds like a long day…") instead of the structured JSON schema. The server logs `LLM returned natural language instead of JSON, treating as unknown` and drops the response.
- When forced into a typed answer, the model picks `unknown`, which by definition produces no spoken response — breaking the conversational flow the open context implies.

The user-facing intent is clear: while the dialogue is open, the assistant should respond conversationally. There is no need for a separate top-level intent type — `query` already covers "speak a response, take no automation action" and is the natural home for chitchat.

## Decision

Chitchat Follow-up Utterances are classified as `type: "query"` with a populated `spokenResponse` (or `response`) field and no `query` payload requiring external lookup.

- The classifier's system prompt is updated to permit conversational `query` responses when `conversationHistory` is non-empty (i.e. inside an open Conversation Context).
- The output must remain valid JSON conforming to the `ClassifiedIntent` schema; prose-only replies are not acceptable.
- `intentConfidence` applies as for any `query`. Below threshold, the Hedged/Clarifying path runs as today (ADR 0007 / issue #49).
- For Directed Questions (empty `conversationHistory`), behaviour is unchanged: chitchat is not invited at session open — the user is presumed to be addressing the system for a reason.

## Rationale

**Reuse over invention.** `query` already means "respond by speaking, no side effect". Adding a `chitchat` discriminator would force every downstream handler to branch on a distinction the dispatcher does not care about.

**Bounded by ADR 0013.** Concern that chitchat keeps the mic open forever is addressed by the Conversation Idle Timeout — the dialogue closes after 30s of silence regardless of how chatty it was.

**Schema discipline.** Forcing JSON for conversational replies keeps the contract uniform and makes the "natural language fallback" code path a hard error signal rather than a routine event.

## Consequences

- `openai-intent-classifier.ts` prompt gains explicit guidance: inside an open conversation, `query` responses may be conversational; output remains JSON.
- No change to the `ClassifiedIntent` schema or to the `IntentClassifier` port.
- `voice-automation-service.ts` already speaks `intent.spokenResponse ?? intent.response` for `query` intents — no orchestration change needed.
- Server log "LLM returned natural language instead of JSON" becomes a true error indicator again (no longer triggered by every chitchat turn).
- Future ADR can promote `chitchat` to a distinct type if telemetry shows the conversational path needs different routing (e.g. different caching, persona shaping, or analytics).

## Alternatives considered

**New `chitchat` intent type** — cleaner taxonomy but requires schema, port, and dispatcher changes across `voice-automation-service`, classifier, tests, and dashboard. No behavioural benefit today.

**Drop chitchat entirely; treat as `unknown`** — breaks the conversational affordance an open context implies. Users would experience the system as "going silent" mid-dialogue.

**Free-text prose fallback** — abandons schema discipline. Hides real classifier failures behind a permissive parser.
