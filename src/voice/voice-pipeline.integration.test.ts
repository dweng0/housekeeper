import { describe, it, expect, vi } from "vitest";
import type {
  Automation,
  AutomationRepository,
  Device,
  DeviceGateway,
  DeviceRepository,
  SpeechOutput,
  VoiceNodeHub,
} from "../ports.js";
import { makeOpenAIIntentClassifier } from "./openai-intent-classifier.js";
import { makeVoiceAutomationService } from "./voice-automation-service.js";

const DEVICES: Device[] = [
  { id: "d1", label: "Living Room Light", topic: "zigbee2mqtt/living-room-light", type: "actuator" },
  { id: "d2", label: "Kitchen Light",     topic: "zigbee2mqtt/kitchen-light",      type: "actuator" },
  { id: "d3", label: "Bedroom Light",     topic: "zigbee2mqtt/bedroom-light",      type: "actuator" },
  { id: "d4", label: "Front Door",        topic: "zigbee2mqtt/front-door",         type: "sensor"   },
];

const NODE_ID = "sim-node";
const SYSTEM_NAME = process.env.SYSTEM_NAME ?? "housekeeper";

function makeDeviceRepo(): DeviceRepository {
  return {
    findAll: async () => DEVICES,
    findByLabel: async (label) => DEVICES.find((d) => d.label === label) ?? null,
    save: async () => {},
    delete: async () => {},
  };
}

function makeAutomationRepo(): AutomationRepository & { saved: Automation[] } {
  const saved: Automation[] = [];
  return {
    saved,
    findAll: async () => saved,
    findById: async (id) => saved.find((a) => a.id === id) ?? null,
    save: async (a) => { saved.push(a); },
    delete: async () => {},
  };
}

function makeLoggingGateway() {
  const published: { topic: string; payload: string }[] = [];
  const gateway: DeviceGateway = {
    publish: vi.fn(async (topic, payload) => {
      console.log(`[GATEWAY] ${topic} ← ${payload}`);
      published.push({ topic, payload });
    }),
    subscribe: vi.fn(),
  };
  return { gateway, published };
}

function makeLoggingSpeech() {
  const spoken: { text: string; nodeId: string }[] = [];
  const output: SpeechOutput = {
    speak: async (text, nodeId) => {
      console.log(`[SPEECH] ${text}`);
      spoken.push({ text, nodeId });
    },
  };
  return { output, spoken };
}

function makeVoiceHub() {
  let handler: ((nodeId: string, text: string) => void) | undefined;
  const hub: VoiceNodeHub = {
    start: vi.fn(),
    stop: vi.fn(),
    onUtterance: (h) => { handler = h; },
    sendTts: vi.fn(),
    sendConfig: vi.fn(),
    getNode: vi.fn(),
    getConnectedNodes: vi.fn(() => []),
    pushUtterance: vi.fn(),
  };
  const emit = (text: string) => {
    console.log(`[UTTERANCE] ${text}`);
    handler?.(NODE_ID, text);
  };
  return { hub, emit };
}

function makeRealClassifier() {
  return makeOpenAIIntentClassifier({
    endpoint: process.env.LLM_ENDPOINT ?? "http://localhost:11434/v1",
    model: process.env.LLM_MODEL ?? "llama3.2",
    apiKey: process.env.LLM_API_KEY,
    devices: makeDeviceRepo(),
  });
}

describe("voice pipeline integration (real LLM)", { timeout: 30_000 }, () => {
  it("device-control: 'turn on the living room light' → publishes to gateway", async () => {
    const { hub, emit } = makeVoiceHub();
    const { gateway, published } = makeLoggingGateway();
    const { output, spoken } = makeLoggingSpeech();

    const service = makeVoiceAutomationService({
      voiceNodeHub: hub,
      systemName: SYSTEM_NAME,
      classifier: makeRealClassifier(),
      devices: makeDeviceRepo(),
      automations: makeAutomationRepo(),
      speechOutput: output,
      gateway,
    });

    service.start();
    emit(`${SYSTEM_NAME} turn on the living room light`);

    await vi.waitFor(() => expect(published).toHaveLength(1), { timeout: 28_000 });

    expect(published[0].topic).toBe("zigbee2mqtt/living-room-light");
    expect(spoken[0].text).toMatch(/living room light/i);
  });

  it("device-control: 'turn off the kitchen light' → publishes off command", async () => {
    const { hub, emit } = makeVoiceHub();
    const { gateway, published } = makeLoggingGateway();
    const { output, spoken } = makeLoggingSpeech();

    const service = makeVoiceAutomationService({
      voiceNodeHub: hub,
      systemName: SYSTEM_NAME,
      classifier: makeRealClassifier(),
      devices: makeDeviceRepo(),
      automations: makeAutomationRepo(),
      speechOutput: output,
      gateway,
    });

    service.start();
    emit(`${SYSTEM_NAME} turn off the kitchen light`);

    await vi.waitFor(() => expect(published).toHaveLength(1), { timeout: 28_000 });

    expect(published[0].topic).toBe("zigbee2mqtt/kitchen-light");
    expect(spoken[0].text).toMatch(/kitchen light/i);
  });

  it("create-automation: 'when front door opens turn on bedroom light'", async () => {
    const { hub, emit } = makeVoiceHub();
    const { gateway } = makeLoggingGateway();
    const { output } = makeLoggingSpeech();
    const automations = makeAutomationRepo();

    const service = makeVoiceAutomationService({
      voiceNodeHub: hub,
      systemName: SYSTEM_NAME,
      classifier: makeRealClassifier(),
      devices: makeDeviceRepo(),
      automations,
      speechOutput: output,
      gateway,
    });

    service.start();
    emit(`${SYSTEM_NAME} when the front door opens turn on the bedroom light`);

    await vi.waitFor(() => expect(automations.saved).toHaveLength(1), { timeout: 28_000 });

    expect(automations.saved[0].trigger.deviceLabel).toBe("Front Door");
    expect(automations.saved[0].actions[0].deviceLabel).toBe("Bedroom Light");
  });

  it("compound: 'this is Jay, turn on the living room light' → sets resident + controls device + addresses by name", async () => {
    const { hub, emit } = makeVoiceHub();
    const { gateway, published } = makeLoggingGateway();
    const { output, spoken } = makeLoggingSpeech();
    const { makeResidentSession } = await import("../memory/resident-session.js");
    const session = makeResidentSession();

    const service = makeVoiceAutomationService({
      voiceNodeHub: hub,
      systemName: SYSTEM_NAME,
      classifier: makeRealClassifier(),
      devices: makeDeviceRepo(),
      automations: makeAutomationRepo(),
      speechOutput: output,
      gateway,
      session,
    });

    service.start();
    emit(`${SYSTEM_NAME} this is Jay, turn on the living room light`);

    await vi.waitFor(() => expect(published).toHaveLength(1), { timeout: 28_000 });

    expect(session.getActive()).toBe("Jay");
    expect(published[0].topic).toBe("zigbee2mqtt/living-room-light");
    expect(spoken[0].text).toMatch(/Jay/i);
  });
});
