Status: done

# Project scaffold

## What to build

Set up the full development environment and project structure. Covers devenv.sh config, TypeScript monorepo with Express and React/Vite, hexagonal folder layout (`src/voice`, `src/automation`, `src/memory`), port interfaces as TypeScript types, and `data/` directory with empty `devices.json` and `automations.json`.

## Acceptance criteria

- [x] `devenv shell` gives Node LTS + TypeScript toolchain
- [x] `devenv up` starts Mosquitto and Ollama
- [x] `devenv.local.nix` is gitignored and overrides env vars (MQTT host, LLM endpoint, etc.)
- [x] Express server starts and serves a health endpoint
- [x] React + Vite dev server starts with shadcn/ui installed
- [x] Folder structure: `src/voice/`, `src/automation/`, `src/memory/`, `data/`
- [x] Port interfaces defined as TypeScript types: `SpeechInput`, `IntentClassifier`, `AutomationRepository`, `DeviceRepository`, `DeviceGateway`, `MemoryStore`, `HttpApi`
- [x] `data/devices.json` and `data/automations.json` exist (empty arrays)

## Blocked by

None — can start immediately.
