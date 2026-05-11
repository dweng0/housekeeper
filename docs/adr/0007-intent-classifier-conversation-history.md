# ADR 0007 — Intent Classifier accepts structured Conversation History

## Status
Accepted

## Context
Adding Conversation Context requires the Intent Classifier to reason over prior exchanges ("but why?", "actually make it dim instead"). Two options for passing history to the classifier:

- **Option A**: Inject history as a text block into the existing system prompt.
- **Option B**: Pass history as a structured OpenAI message array (`role: user/assistant` turns), added as an optional `conversationHistory` field on the classifier input.

## Decision
Option B — structured message array.

LLMs resolve ambiguous follow-ups more reliably when history is presented as native chat turns rather than an embedded text block. The port change is minimal: `conversationHistory` is optional, so all existing callers (Directed Questions with no prior context) remain unchanged.

## Consequences
- `IntentClassifier` port gains an optional `conversationHistory: Array<{ role: "user" | "assistant"; content: string }>` field on its input type.
- `openai-intent-classifier.ts` prepends these turns between the system prompt and the current user message.
- Callers that open a Conversation Context must maintain and trim the history to the rolling token budget before passing it.
- Option A (text injection) is ruled out — do not revert to it for follow-up handling.
