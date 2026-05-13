# ADR 0013 — Conversation Context Idle Timeout

## Status
Accepted (supersedes the no-timer decision implied by issue #51)

## Context

The Conversation Context opens after a Directed Question receives a spoken response and stays open so Follow-up Utterances are routed to the Intent Classifier without requiring the System Name (per ADR 0007).

Issue #51 removed the original 30-second timer in favour of bounding the context by token budget alone — the rolling history drops oldest turns once it exceeds `HISTORY_TOKEN_BUDGET`. The premise was that the LLM can infer state transitions from full history.

In practice this leaves the context open indefinitely as long as nothing is spoken. With multiple residents present, television playback, or ambient household speech, every transcribed Utterance from a Voice Node flows into the classifier as a Follow-up Utterance. Symptoms observed: `[BLANK_AUDIO]`, `(sighs)`, third-party TV dialogue, and unrelated chitchat are routed to OpenAI; the model often replies in natural language ("Sounds like a long day…") which the server cannot parse as JSON, and the loop perpetuates because every classification still appends a turn.

Token-budget bounding controls memory size; it does not bound real-time exposure of the microphone to the LLM.

## Decision

Reintroduce an **idle timeout** on the Conversation Context.

- The context closes automatically when no Turn has been appended for `idleTimeoutMs` milliseconds.
- Default: `30_000` (30 seconds). Configurable via the same config surface as `historyTokenBudget` and `intentConfidenceThreshold`.
- `ConversationContext.isOpen()` returns `false` once the timeout has elapsed since the last `addTurn(...)` call, even though prior turns remain in history for the next session (which will only reopen via a fresh Directed Question — `addTurn` is the only path to `open = true`).
- Reset semantics from ADR 0007 unchanged: new Directed Question, `set-resident` intent, and token-budget overflow continue to reset/trim. The timeout is an *additional* close trigger, not a replacement.
- Token-budget bounding from #51 is retained for memory management.

## Rationale

A dialogue is a bounded interaction in time. The user's mental model is: "I addressed the system; we are now in conversation; the conversation ends when we stop talking." The System Name is the explicit re-open signal once silence has closed the dialogue.

Without a wall-clock bound, ambient room audio is treated as conversation forever. The LLM cost, latency, and false-positive surface grow unboundedly. Token-budget alone is a memory bound, not a presence bound.

30 seconds matches typical human conversational gap tolerance and the prior implementation removed in #51 — restoring the value avoids re-tuning.

## Consequences

- `ConversationContext` regains an internal timestamp (`lastTurnAt`) updated on `addTurn(...)`; `isOpen()` checks elapsed time against `idleTimeoutMs`.
- No `setTimeout` required — check lazily on `isOpen()` read. Avoids the timer-leak class of bugs that motivated #51.
- `voice-automation-service.ts` passes `idleTimeoutMs` from config when constructing the context.
- `src/voice/CONTEXT.md` gains a **Conversation Idle Timeout** glossary entry.
- Issue #51's acceptance criterion "isOpen() only returns true after addTurn() is called" remains satisfied — opening is still turn-driven; closing now has two triggers (explicit reset, idle timeout).
- After idle close, the next Utterance from that Voice Node is treated as ambient; the System Name is required to reopen.

## Alternatives considered

**Keep no-timer, rely on classifier `type: "unknown"` to close** — fragile. The LLM frequently returns non-`unknown` responses to ambient speech. Couples lifecycle control to model behaviour.

**Close on N consecutive low-confidence intents** — opaque to users; "why did it stop responding?" hard to diagnose. Wall-clock matches user expectation.

**Timer fires `setTimeout` and explicitly resets** — re-creates the bug class #51 cited. Lazy check on read is sufficient — `isOpen()` is called per ambient utterance, which is the only moment the answer matters.
