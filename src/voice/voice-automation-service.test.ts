import { describe, it, expect, vi } from "vitest";
import type {
  Automation,
  AutomationRepository,
  ClassifiedIntent,
  Device,
  DeviceRepository,
  IntentClassifier,
  SpeechInput,
  SpeechOutput,
} from "../ports.js";
import { makeVoiceAutomationService } from "./voice-automation-service.js";

const sensor: Device = { id: "d1", label: "Front Door", topic: "home/front-door", type: "sensor" };
const actuator: Device = { id: "d2", label: "Porch Light", topic: "home/porch-light", type: "actuator" };

function makeSpeechInput() {
  let handler: ((t: string) => void) | undefined;
  const input: SpeechInput = {
    startListening: vi.fn(),
    stopListening: vi.fn(),
    onUtterance: (h) => { handler = h; },
  };
  const emit = (text: string) => handler?.(text);
  return { input, emit };
}

function makeDeviceRepo(devices: Device[]): DeviceRepository {
  return {
    findAll: async () => devices,
    findByLabel: async (label) => devices.find((d) => d.label === label) ?? null,
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

function makeClassifier(intent: ClassifiedIntent): IntentClassifier {
  return { classify: async () => intent };
}

function makeSpeechOutput() {
  const spoken: string[] = [];
  const output: SpeechOutput = { speak: async (t) => { spoken.push(t); } };
  return { output, spoken };
}

describe("VoiceAutomationService", () => {
  it("creates Automation when directed question resolves valid device labels", async () => {
    const { input, emit } = makeSpeechInput();
    const automationRepo = makeAutomationRepo();
    const intent: ClassifiedIntent = {
      type: "create-automation",
      automation: {
        enabled: true,
        trigger: { deviceLabel: "Front Door", event: "open" },
        actions: [{ deviceLabel: "Porch Light", command: "on" }],
      },
    };
    const { output } = makeSpeechOutput();

    const service = makeVoiceAutomationService({
      speechInput: input,
      systemName: "Jarvis",
      classifier: makeClassifier(intent),
      devices: makeDeviceRepo([sensor, actuator]),
      automations: automationRepo,
      speechOutput: output,
    });

    service.start();
    emit("Jarvis when the front door opens turn on the porch light");
    await vi.waitFor(() => expect(automationRepo.saved).toHaveLength(1));

    expect(automationRepo.saved[0].trigger.deviceLabel).toBe("Front Door");
    expect(automationRepo.saved[0].id).toBeDefined();
  });

  it("speaks error when trigger device label not found", async () => {
    const { input, emit } = makeSpeechInput();
    const { output, spoken } = makeSpeechOutput();
    const intent: ClassifiedIntent = {
      type: "create-automation",
      automation: {
        enabled: true,
        trigger: { deviceLabel: "Unknown Sensor", event: "open" },
        actions: [{ deviceLabel: "Porch Light", command: "on" }],
      },
    };

    const service = makeVoiceAutomationService({
      speechInput: input,
      systemName: "Jarvis",
      classifier: makeClassifier(intent),
      devices: makeDeviceRepo([actuator]),
      automations: makeAutomationRepo(),
      speechOutput: output,
    });

    service.start();
    emit("Jarvis do something");
    await vi.waitFor(() => expect(spoken).toHaveLength(1));

    expect(spoken[0]).toMatch(/Unknown Sensor/);
  });

  it("does nothing for unknown intent", async () => {
    const { input, emit } = makeSpeechInput();
    const automationRepo = makeAutomationRepo();
    const { output, spoken } = makeSpeechOutput();

    const service = makeVoiceAutomationService({
      speechInput: input,
      systemName: "Jarvis",
      classifier: makeClassifier({ type: "unknown" }),
      devices: makeDeviceRepo([sensor, actuator]),
      automations: automationRepo,
      speechOutput: output,
    });

    service.start();
    emit("Jarvis");
    await new Promise((r) => setTimeout(r, 20));

    expect(automationRepo.saved).toHaveLength(0);
    expect(spoken).toHaveLength(0);
  });

  it("does not classify utterances without System Name", async () => {
    const { input, emit } = makeSpeechInput();
    const classifySpy = vi.fn().mockResolvedValue({ type: "unknown" } as ClassifiedIntent);
    const { output } = makeSpeechOutput();

    const service = makeVoiceAutomationService({
      speechInput: input,
      systemName: "Jarvis",
      classifier: { classify: classifySpy },
      devices: makeDeviceRepo([]),
      automations: makeAutomationRepo(),
      speechOutput: output,
    });

    service.start();
    emit("turn on the lights");
    await new Promise((r) => setTimeout(r, 20));

    expect(classifySpy).not.toHaveBeenCalled();
  });

  it("assigns a unique id to each created Automation", async () => {
    const { input, emit } = makeSpeechInput();
    const automationRepo = makeAutomationRepo();
    const intent: ClassifiedIntent = {
      type: "create-automation",
      automation: {
        enabled: true,
        trigger: { deviceLabel: "Front Door", event: "open" },
        actions: [{ deviceLabel: "Porch Light", command: "on" }],
      },
    };
    const { output } = makeSpeechOutput();

    const service = makeVoiceAutomationService({
      speechInput: input,
      systemName: "Jarvis",
      classifier: makeClassifier(intent),
      devices: makeDeviceRepo([sensor, actuator]),
      automations: automationRepo,
      speechOutput: output,
    });

    service.start();
    emit("Jarvis when the front door opens turn on the porch light");
    emit("Jarvis when the front door opens turn on the porch light");
    await vi.waitFor(() => expect(automationRepo.saved).toHaveLength(2));

    expect(automationRepo.saved[0].id).not.toBe(automationRepo.saved[1].id);
  });
});
