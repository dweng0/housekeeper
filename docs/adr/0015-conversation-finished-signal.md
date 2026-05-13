# ADR 0015 — Conversation Finished Signal

## Status

Accepted

## Context

The Conversation Context opens after a Directed Question receives a spoken response, allowing Follow-up Utterances without requiring the System Name. The context currently closes via:

1. Conversation Idle Timeout (30s of silence, per ADR 0013)
2. New Directed Question
3. Resident change (`set-resident` intent)

Problem: the LLM often produces responses that naturally signal conversation closure (e.g., "Let me know if you need anything else"). Despite this, the context stays open until idle timeout, causing:

- Ambient speech (TV, other residents) to be routed to the classifier during the 30s window
- False-positive intent classification on unrelated utterances
- Unnecessary LLM calls and latency

The LLM already knows when it has "finished" a dialogue. We can leverage this to close the context proactively.

## Decision

Add a `conversationFinished` field (0–1) to `ClassifiedIntent` when the Conversation Context is open (Follow-up Utterances only).

- `1` = conversation should close after this response
- `0` = conversation should continue
- Intermediate values indicate uncertainty

The context closes when `conversationFinished >= conversationFinishedThreshold` (default `0.5`, configurable in dashboard).

### When emitted

Only during Follow-up Utterances (when `conversationHistory` is non-empty). Directed Questions do not include this field.

### Coexistence with idle timeout

Both mechanisms coexist. The context closes when either:
- `conversationFinished >= threshold` (after TTS completes)
- Idle timeout elapses (30s of silence)

Whichever happens first closes the context.

### Close behavior

When the conversation finishes:
- `ctx.reset()` is called, clearing history and setting `open = false`
- No turn is added to history
- The user must speak the System Name to reopen

### Threshold configuration

New config field: `conversationFinishedThreshold` (default `0.5`). Configurable via dashboard alongside `intentConfidenceThreshold`.

### Backward compatibility

If `conversationFinished` is missing (Directed Question, older behavior, edge case), treat as `0` — conversation stays open.

### System prompt guidance

The classifier prompt will include:

> "When conversationHistory is non-empty (follow-up utterance), include a `conversationFinished` field (0–1).
> - 1.0 = your response signals the conversation is complete (e.g., offering further help, no follow-up expected)
> - 0.0 = conversation should continue (e.g., you asked a clarifying question, expect more from user)
> - Use intermediate values for uncertainty."

### Implementation location

In `voice-automation-service.ts`, the `onAmbientUtterance` handler's `finally` block:

```ts
finally {
  const finished = intent.conversationFinished ?? 0;
  const threshold = cfg?.conversationFinishedThreshold ?? 0.5;
  if (finished >= threshold) {
    ctx.reset();
  } else {
    ctx.addTurn(text, spokenResponse ?? "");
  }
}
```

## Rationale

**Natural closure matches user expectation.** When the LLM says "Let me know if you need anything else," the user understands the conversation has ended. Keeping the mic open for 30s afterwards violates this mental model.

**Reduces false-positive surface.** Proactive closure limits ambient speech exposure to the classifier, reducing cost and spurious intents.

**LLM already knows.** The model can judge whether its response invites further dialogue. Leveraging this is more accurate than a fixed timeout.

**Separate from intent confidence.** `intentConfidence` judges correctness of intent classification. `conversationFinished` judges dialogue state. These are orthogonal concerns.

## Consequences

- `ClassifiedIntent` schema gains optional `conversationFinished?: number`
- Classifier prompt updated to emit this field on Follow-up Utterances
- `AppConfig` gains `conversationFinishedThreshold?: number`
- Dashboard config UI gains threshold slider/field
- `voice-automation-service.ts` finally block refactored as above
- `src/voice/CONTEXT.md` gains glossary entry for `Conversation Finished`
- Tests added for threshold comparison, missing field, reset behavior

## Alternatives considered

**Reuse `intentConfidence` for closure** — conflates two orthogonal signals. Low intent confidence might still want to continue the conversation (clarifying question), not close it.

**Close on N consecutive low-confidence intents** — opaque to users. "Why did it stop responding?" hard to diagnose. LLM-driven closure is explicit and natural.

**Only idle timeout, no proactive closure** — current behavior. Causes the problems described in context.

**Tone/audio signal on closure** — unnecessary. The LLM's closing phrase ("Let me know if you need anything else") is already the natural signal.