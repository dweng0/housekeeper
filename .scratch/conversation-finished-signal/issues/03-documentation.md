Status: ready-for-agent
Category: enhancement

## Parent

ADR 0015 — Conversation Finished Signal (`docs/adr/0015-conversation-finished-signal.md`)

## What to build

Update `src/voice/CONTEXT.md` glossary with the `Conversation Finished` term, documenting its semantics and relationship to the Conversation Context lifecycle.

## Acceptance criteria

- [ ] `src/voice/CONTEXT.md` includes `Conversation Finished` glossary entry
- [ ] Entry defines: 0–1 value, meaning (1 = close, 0 = continue), when emitted (Follow-up Utterances only)
- [ ] Entry references ADR 0015
- [ ] Relationships section updated: Conversation Context closes on Conversation Finished signal OR idle timeout

## Blocked by

None - can start immediately