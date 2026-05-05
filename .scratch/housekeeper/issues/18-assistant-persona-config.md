Status: done

# Configurable assistant persona

## What to build

Add a configurable persona string that prepends the LLM system prompt. Editable via the dashboard settings page. A sensible default is provided so the system works out of the box.

Default:
```
You are a friendly and helpful smart home assistant called {SYSTEM_NAME}. You live in the home and help residents control devices and set up automations.
```

The persona string is stored in the server config (JSON file, alongside existing config). The intent classifier prepends it to the existing structured prompt.

## Acceptance criteria

- [x] Default persona used when none configured
- [x] Persona persisted to config file on save
- [x] Dashboard settings page shows a textarea to edit persona
- [x] Save button PUTs to `PUT /api/config` (implemented as unified config PUT, not `/api/config/persona`)
- [x] `{SYSTEM_NAME}` placeholder replaced at runtime with the configured system name
- [x] Changing persona takes effect on next classify call (no restart required)

## Out of scope

- Per-resident personas
- Prompt versioning / history
