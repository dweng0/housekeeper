# Housekeeper

An AI-centric smart home system where natural language is the primary interface for creating and managing home automations.

[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-LTS-green?logo=node.js&logoColor=white)](https://nodejs.org/)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Status](https://img.shields.io/badge/status-active%20development-green.svg)]()

## Overview

Housekeeper takes a unique approach to smart home automation: **AI interprets intent at authoring time, and a deterministic automation engine executes rules at runtime.** This means you speak naturally to create automations, and they run reliably without ongoing AI involvement.

### Example

> **You:** "Jarvis, when the front door opens, turn on the porch light for 10 seconds."

The AI resolves "front door" and "porch light" to their registered devices, then creates an automation. From that point on, the automation engine handles it — no AI needed at runtime.

## Features

- **Natural Language Automation Creation**: Speak or type automations in plain English
- **Always-On STT**: Continuous speech-to-text with intelligent directed question detection
- **MQTT Device Integration**: Connect and control MQTT-enabled sensors and actuators
- **Auto-Discovery**: Automatically detect new devices on your MQTT broker
- **Resident Sessions**: Personalized experiences with memory contexts per household member
- **Deterministic Execution**: Reliable rule-based automation engine
- **Modern Dashboard**: React-based UI for device management and monitoring

## Architecture

Housekeeper follows a hexagonal architecture pattern with clear ports and adapters:

```
┌─────────────────────────────────────────────────────────────┐
│                        Inbound Ports                        │
│  Speech Input │ Intent Classifier │ HTTP API               │
└──────────────────────┬──────────────────────────────────────┘
                       │
              ┌────────┴────────┐
              │   Application    │
              │     Core         │
              └────────┬────────┘
                       │
┌──────────────────────┴──────────────────────────────────────┐
│                       Outbound Ports                        │
│  MQTT Gateway │ Repositories │ Memory Store │ TTS │ UI     │
└─────────────────────────────────────────────────────────────┘
```

## Tech Stack

| Component | Technology |
|-----------|------------|
| **Server** | Node.js (LTS) + TypeScript + Express |
| **Dashboard** | React + Vite + shadcn/ui (Tailwind + Radix) |
| **Automation Storage** | JSON files |
| **MQTT Broker** | Mosquitto (local dev, external prod) |
| **LLM** | OpenAI-compatible endpoint (Ollama in dev) |
| **Memory** | mem0 (TypeScript SDK) |
| **STT** | Whisper |
| **TTS** | Piper |
| **Dev Environment** | devenv.sh |

## Getting Started

### Prerequisites

- [devenv](https://devenv.sh/) or Node.js 22+
- MQTT broker (Mosquitto recommended)
- (Optional) Ollama for local LLM

### Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/dweng0/housekeeper.git
   cd housekeeper
   ```

2. Using devenv (recommended):
   ```bash
   devenv shell
   devenv up  # Starts MQTT and other services
   ```

   Or using npm directly:
   ```bash
   npm install
   ```

3. Configure environment:
   ```bash
   cp devenv.local.nix.example devenv.local.nix
   # Edit devenv.local.nix with your settings
   ```

4. Start development server:
   ```bash
   npm run dev
   ```

### Development

```bash
npm run dev          # Start dev server with hot reload
npm run build        # Build for production
npm run typecheck    # Run TypeScript type checking
npm run test         # Run tests
npm run test:watch   # Run tests in watch mode
```

## Project Structure

```
housekeeper/
├── src/
│   ├── automation/      # Automation engine and repositories
│   ├── device/          # Device management and auto-discovery
│   ├── memory/          # Resident sessions and mem0 integration
│   ├── mqtt/            # MQTT gateway adapter
│   ├── voice/           # STT, intent classification, TTS
│   └── ports.ts         # Hexagonal architecture port definitions
├── client/             # React dashboard
├── data/               # JSON storage files
└── docs/
    └── adr/            # Architecture Decision Records
```

## Architecture Decision Records

Key design decisions are documented in `docs/adr/`:

- [ADR-0001: AI Authoring-Time Only](docs/adr/0001-ai-authoring-time-only.md)
- [ADR-0002: Always-On STT with Directed Question Detection](docs/adr/0002-always-on-stt-directed-question.md)
- [ADR-0003: STT Engine Selection](docs/adr/0003-stt-engine.md)

## Contributing

Contributions are welcome! Please read our contributing guidelines before submitting PRs.

## License

MIT License - see [LICENSE](LICENSE) file for details.

---

Built with ❤️ for smarter homes