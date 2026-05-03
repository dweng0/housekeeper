Status: done

# Resident session management + mem0 integration

## What to build

"Jarvis, this is Jay" sets an active Resident Session. All subsequent Directed Questions are scoped to that Resident's mem0 context. Falls back to Household Memory when no Resident is active. Memory context is injected into the LLM system prompt.

## Acceptance criteria

- [x] `MemoryStore` port interface implemented via mem0 TypeScript SDK adapter
- [x] "Jarvis, this is [name]" Directed Question sets active Resident Session (in-memory, resets on restart)
- [x] Resident Session scopes mem0 reads/writes to that Resident's context
- [x] No active session falls back to Household Memory context
- [x] Active Resident's relevant memories injected into `IntentClassifier` system prompt
- [x] After Automation created, relevant facts stored back to Resident (or Household) memory

## Blocked by

- Issue 08 (Directed Question classification)
