# Memory Context

Manages Resident identity and scoped memory via mem0. Provides personalised context to the AI at authoring time.

## Language

**Resident**:
A named person in the household whose preferences and history are stored as a scoped memory context in mem0. Identified initially by named session ("Jarvis, this is Jay"); voice fingerprinting is a planned future capability.
_Avoid_: user, person, occupant

**Resident Session**:
The active named context for the current interaction. Set explicitly by a Resident identifying themselves. Falls back to household-level memory when no Resident is identified.
_Avoid_: user session, login, profile

**Household Memory**:
Shared mem0 context scoped to the home rather than any individual Resident. Used as fallback when no Resident Session is active.
_Avoid_: default memory, global context

## Relationships

- A **Directed Question** is scoped to the active **Resident Session**, or falls back to **Household Memory**
- A **Resident** has one scoped memory context in mem0
- **Household Memory** is shared across all Residents
