Status: ready-for-agent
Category: enhancement

## Parent

ADR 0015 — Conversation Finished Signal (`docs/adr/0015-conversation-finished-signal.md`)

## What to build

Implement the `conversationFinished` field on `ClassifiedIntent` for Follow-up Utterances. When the LLM outputs this field and it exceeds the threshold, the Conversation Context closes after TTS completes (clearing history, requiring System Name to reopen).

End-to-end behavior:
- LLM receives Follow-up Utterance with conversation history
- LLM outputs `conversationFinished` (0–1) alongside its response
- Service checks threshold after speaking
- If `conversationFinished >= threshold`, context resets (no turn added)
- If below threshold, turn is added and context stays open

## Acceptance criteria

- [ ] `ClassifiedIntent` schema includes optional `conversationFinished?: number`
- [ ] Classifier system prompt includes guidance for `conversationFinished` (when conversationHistory non-empty)
- [ ] `voice-automation-service.ts` finally block uses conditional: if finished >= threshold → reset, else → addTurn
- [ ] Missing `conversationFinished` treated as `0` (stay open)
- [ ] Test: high `conversationFinished` (>= threshold) closes context after response
- [ ] Test: low `conversationFinished` (< threshold) keeps context open
- [ ] Test: missing field keeps context open
- [ ] Test: Directed Question does not expect/require `conversationFinished`

## Blocked by

None - can start immediately