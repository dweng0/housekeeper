import { describe, it, expect, vi } from "vitest";
import type {
  Automation,
  AutomationRepository,
  ClassifiedIntent,
  Device,
  DeviceGateway,
  DeviceRepository,
  IntentClassifier,
  MemoryStore,
  VoiceNodeHub,
  SpeechOutput,
} from "../ports.js";
import { makeResidentSession } from "../memory/resident-session.js";
import { makeVoiceAutomationService } from "./voice-automation-service.js";

function makeMemoryStore(): MemoryStore & { stored: { residentId: string; fact: string }[] } {
  const stored: { residentId: string; fact: string }[] = [];
  const memories: Map<string, string[]> = new Map();
  return {
    stored,
    store: vi.fn(async (residentId, fact) => {
      stored.push({ residentId, fact });
      memories.set(residentId, [...(memories.get(residentId) ?? []), fact]);
    }),
    search: vi.fn(async (residentId, _query) => memories.get(residentId) ?? []),
    clear: vi.fn(async () => {}),
  };
}

const sensor: Device = { id: "d1", label: "Front Door", topic: "home/front-door", type: "sensor" };
const actuator: Device = { id: "d2", label: "Porch Light", topic: "home/porch-light", type: "actuator" };

const TEST_NODE_ID = "node-hallway";

function makeVoiceNodeHub() {
  let handler: ((nodeId: string, t: string) => void) | undefined;
  const hub: VoiceNodeHub = {
    start: vi.fn(),
    stop: vi.fn(),
    onUtterance: (h) => { handler = h; },
    sendTts: vi.fn(),
    sendConfig: vi.fn(),
    getNode: vi.fn(),
    getConnectedNodes: vi.fn(() => []),
  };
  const emit = (text: string, nodeId = TEST_NODE_ID) => handler?.(nodeId, text);
  return { hub, emit };
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
  const spoken: { text: string; nodeId: string }[] = [];
  const output: SpeechOutput = { speak: async (text, nodeId) => { spoken.push({ text, nodeId }); } };
  return { output, spoken };
}

function makeGateway() {
  const published: { topic: string; payload: string }[] = [];
  const gateway: DeviceGateway = {
    publish: vi.fn(async (topic, payload) => { published.push({ topic, payload }); }),
    subscribe: vi.fn(),
  };
  return { gateway, published };
}

describe("VoiceAutomationService", () => {
  it("creates Automation when directed question resolves valid device labels", async () => {
    const { hub, emit } = makeVoiceNodeHub();
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
      voiceNodeHub: hub,
      systemName: "housekeeper",
      classifier: makeClassifier(intent),
      devices: makeDeviceRepo([sensor, actuator]),
      automations: automationRepo,
      speechOutput: output,
    });

    service.start();
    emit("housekeeper when the front door opens turn on the porch light");
    await vi.waitFor(() => expect(automationRepo.saved).toHaveLength(1));

    expect(automationRepo.saved[0].trigger.deviceLabel).toBe("Front Door");
    expect(automationRepo.saved[0].id).toBeDefined();
  });

  it("speaks error when trigger device label not found", async () => {
    const { hub, emit } = makeVoiceNodeHub();
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
      voiceNodeHub: hub,
      systemName: "housekeeper",
      classifier: makeClassifier(intent),
      devices: makeDeviceRepo([actuator]),
      automations: makeAutomationRepo(),
      speechOutput: output,
    });

    service.start();
    emit("housekeeper do something");
    await vi.waitFor(() => expect(spoken).toHaveLength(1));

    expect(spoken[0].text).toMatch(/Unknown Sensor/);
    expect(spoken[0].nodeId).toBe(TEST_NODE_ID);
  });

  it("does nothing for unknown intent", async () => {
    const { hub, emit } = makeVoiceNodeHub();
    const automationRepo = makeAutomationRepo();
    const { output, spoken } = makeSpeechOutput();

    const service = makeVoiceAutomationService({
      voiceNodeHub: hub,
      systemName: "housekeeper",
      classifier: makeClassifier({ type: "unknown" }),
      devices: makeDeviceRepo([sensor, actuator]),
      automations: automationRepo,
      speechOutput: output,
    });

    service.start();
    emit("housekeeper");
    await new Promise((r) => setTimeout(r, 20));

    expect(automationRepo.saved).toHaveLength(0);
    expect(spoken).toHaveLength(0);
  });

  it("does not classify utterances without System Name", async () => {
    const { hub, emit } = makeVoiceNodeHub();
    const classifySpy = vi.fn().mockResolvedValue({ type: "unknown" } as ClassifiedIntent);
    const { output } = makeSpeechOutput();

    const service = makeVoiceAutomationService({
      voiceNodeHub: hub,
      systemName: "housekeeper",
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

  it("assigns unique ids to distinct Automations", async () => {
    const { hub, emit } = makeVoiceNodeHub();
    const automationRepo = makeAutomationRepo();
    const sensor2: Device = { id: "d3", label: "Back Door", topic: "home/back-door", type: "sensor" };
    const { output } = makeSpeechOutput();
    let call = 0;
    const intents: ClassifiedIntent[] = [
      { type: "create-automation", automation: { enabled: true, trigger: { deviceLabel: "Front Door", event: "open" }, actions: [{ deviceLabel: "Porch Light", command: "on" }] } },
      { type: "create-automation", automation: { enabled: true, trigger: { deviceLabel: "Back Door", event: "open" }, actions: [{ deviceLabel: "Porch Light", command: "on" }] } },
    ];
    const classifier: IntentClassifier = { classify: async () => intents[call++] ?? { type: "unknown" } };

    const service = makeVoiceAutomationService({
      voiceNodeHub: hub,
      systemName: "housekeeper",
      classifier,
      devices: makeDeviceRepo([sensor, sensor2, actuator]),
      automations: automationRepo,
      speechOutput: output,
    });

    service.start();
    emit("housekeeper when front door opens turn on porch light");
    emit("housekeeper when back door opens turn on porch light");
    await vi.waitFor(() => expect(automationRepo.saved).toHaveLength(2));

    expect(automationRepo.saved[0].id).not.toBe(automationRepo.saved[1].id);
  });

  it("rejects duplicate Automation and speaks error", async () => {
    const { hub, emit } = makeVoiceNodeHub();
    const automationRepo = makeAutomationRepo();
    const intent: ClassifiedIntent = {
      type: "create-automation",
      automation: { enabled: true, trigger: { deviceLabel: "Front Door", event: "open" }, actions: [{ deviceLabel: "Porch Light", command: "on" }] },
    };
    const { output, spoken } = makeSpeechOutput();

    const service = makeVoiceAutomationService({
      voiceNodeHub: hub,
      systemName: "housekeeper",
      classifier: makeClassifier(intent),
      devices: makeDeviceRepo([sensor, actuator]),
      automations: automationRepo,
      speechOutput: output,
    });

    service.start();
    emit("housekeeper set it up");
    await vi.waitFor(() => expect(automationRepo.saved).toHaveLength(1));
    emit("housekeeper set it up again");
    await vi.waitFor(() => expect(spoken).toHaveLength(1));

    expect(automationRepo.saved).toHaveLength(1);
    expect(spoken[0].text).toMatch(/already/i);
  });

  it("maintains separate Listening Windows per node", async () => {
    const { hub, emit } = makeVoiceNodeHub();
    const classifySpy = vi.fn().mockResolvedValue({ type: "unknown" } as ClassifiedIntent);
    const { output } = makeSpeechOutput();

    const service = makeVoiceAutomationService({
      voiceNodeHub: hub,
      systemName: "housekeeper",
      classifier: { classify: classifySpy },
      devices: makeDeviceRepo([]),
      automations: makeAutomationRepo(),
      speechOutput: output,
    });

    service.start();
    emit("housekeeper do something", "node-kitchen");
    emit("housekeeper do something", "node-hallway");
    await vi.waitFor(() => expect(classifySpy).toHaveBeenCalledTimes(2));
  });

  describe("device-control intent", () => {
    it("publishes to gateway and speaks confirmation when device found", async () => {
      const { hub, emit } = makeVoiceNodeHub();
      const { output, spoken } = makeSpeechOutput();
      const { gateway, published } = makeGateway();
      const intent: ClassifiedIntent = { type: "device-control", deviceLabel: "Porch Light", command: "on", response: "The porch light is now on." };

      const service = makeVoiceAutomationService({
        voiceNodeHub: hub,
        systemName: "housekeeper",
        classifier: makeClassifier(intent),
        devices: makeDeviceRepo([actuator]),
        automations: makeAutomationRepo(),
        speechOutput: output,
        gateway,
      });

      service.start();
      emit("housekeeper turn on the porch light");
      await vi.waitFor(() => expect(published).toHaveLength(1));

      expect(published[0].topic).toBe("home/porch-light");
      expect(published[0].payload).toBe("on");
      expect(spoken[0].text).toBe("The porch light is now on.");
      expect(spoken[0].nodeId).toBe(TEST_NODE_ID);
    });

    it("resolves command through commandMap before publishing", async () => {
      const { hub, emit } = makeVoiceNodeHub();
      const { output } = makeSpeechOutput();
      const { gateway, published } = makeGateway();
      const deviceWithMap: Device = { id: "d2", label: "Porch Light", topic: "home/porch-light", type: "actuator", commandMap: { on: "1", off: "0" } };
      const intent: ClassifiedIntent = { type: "device-control", deviceLabel: "Porch Light", command: "on" };

      const service = makeVoiceAutomationService({
        voiceNodeHub: hub,
        systemName: "housekeeper",
        classifier: makeClassifier(intent),
        devices: makeDeviceRepo([deviceWithMap]),
        automations: makeAutomationRepo(),
        speechOutput: output,
        gateway,
      });

      service.start();
      emit("housekeeper turn on the porch light");
      await vi.waitFor(() => expect(published).toHaveLength(1));

      expect(published[0].payload).toBe("1");
    });

    it("speaks error and does not publish when device not found", async () => {
      const { hub, emit } = makeVoiceNodeHub();
      const { output, spoken } = makeSpeechOutput();
      const { gateway, published } = makeGateway();
      const intent: ClassifiedIntent = { type: "device-control", deviceLabel: "Nonexistent Light", command: "on" };

      const service = makeVoiceAutomationService({
        voiceNodeHub: hub,
        systemName: "housekeeper",
        classifier: makeClassifier(intent),
        devices: makeDeviceRepo([actuator]),
        automations: makeAutomationRepo(),
        speechOutput: output,
        gateway,
      });

      service.start();
      emit("housekeeper turn on the nonexistent light");
      await vi.waitFor(() => expect(spoken).toHaveLength(1));

      expect(published).toHaveLength(0);
      expect(spoken[0].text).toMatch(/Nonexistent Light/i);
    });
  });

  describe("Resident Session integration", () => {
    it("set-resident intent activates the Resident Session", async () => {
      const { hub, emit } = makeVoiceNodeHub();
      const session = makeResidentSession();
      const { output } = makeSpeechOutput();
      const intent: ClassifiedIntent = { type: "set-resident", residentName: "Jay" };

      const service = makeVoiceAutomationService({
        voiceNodeHub: hub,
        systemName: "housekeeper",
        classifier: makeClassifier(intent),
        devices: makeDeviceRepo([]),
        automations: makeAutomationRepo(),
        speechOutput: output,
        session,
      });

      service.start();
      emit("housekeeper this is Jay");
      await vi.waitFor(() => expect(session.getActive()).toBe("Jay"));
    });

    it("no active session passes household residentId to classifier", async () => {
      const { hub, emit } = makeVoiceNodeHub();
      const session = makeResidentSession(); // no setActive called
      const classifySpy = vi.fn().mockResolvedValue({ type: "unknown" } as ClassifiedIntent);
      const { output } = makeSpeechOutput();

      const service = makeVoiceAutomationService({
        voiceNodeHub: hub,
        systemName: "housekeeper",
        classifier: { classify: classifySpy },
        devices: makeDeviceRepo([]),
        automations: makeAutomationRepo(),
        speechOutput: output,
        session,
        memoryStore: makeMemoryStore(),
      });

      service.start();
      emit("housekeeper what time is it");
      await vi.waitFor(() => expect(classifySpy).toHaveBeenCalledOnce());

      expect(classifySpy).toHaveBeenCalledWith(expect.objectContaining({ utterance: "housekeeper what time is it", residentId: "household", memories: [] }));
    });

    it("classifier receives residentId and memories from memoryStore", async () => {
      const { hub, emit } = makeVoiceNodeHub();
      const session = makeResidentSession();
      session.setActive("Jay");
      const memoryStore = makeMemoryStore();
      await memoryStore.store("Jay", "Jay prefers lights dim at night");
      const classifySpy = vi.fn().mockResolvedValue({ type: "unknown" } as ClassifiedIntent);
      const { output } = makeSpeechOutput();

      const service = makeVoiceAutomationService({
        voiceNodeHub: hub,
        systemName: "housekeeper",
        classifier: { classify: classifySpy },
        devices: makeDeviceRepo([]),
        automations: makeAutomationRepo(),
        speechOutput: output,
        session,
        memoryStore,
      });

      service.start();
      emit("housekeeper turn on lights");
      await vi.waitFor(() => expect(classifySpy).toHaveBeenCalledOnce());

      expect(classifySpy).toHaveBeenCalledWith(expect.objectContaining({
        utterance: "housekeeper turn on lights",
        residentId: "Jay",
        memories: ["Jay prefers lights dim at night"],
      }));
    });
    it("stores automation fact to memoryStore after creation", async () => {
      const { hub, emit } = makeVoiceNodeHub();
      const session = makeResidentSession();
      session.setActive("Jay");
      const memoryStore = makeMemoryStore();
      const { output } = makeSpeechOutput();
      const intent: ClassifiedIntent = {
        type: "create-automation",
        automation: {
          enabled: true,
          trigger: { deviceLabel: "Front Door", event: "open" },
          actions: [{ deviceLabel: "Porch Light", command: "on" }],
        },
      };

      const service = makeVoiceAutomationService({
        voiceNodeHub: hub,
        systemName: "housekeeper",
        classifier: makeClassifier(intent),
        devices: makeDeviceRepo([sensor, actuator]),
        automations: makeAutomationRepo(),
        speechOutput: output,
        session,
        memoryStore,
      });

      service.start();
      emit("housekeeper when front door opens turn on porch light");
      await vi.waitFor(() => expect(memoryStore.stored).toHaveLength(1));

      expect(memoryStore.stored[0].residentId).toBe("Jay");
      expect(memoryStore.stored[0].fact).toMatch(/Front Door/);
      expect(memoryStore.stored[0].fact).toMatch(/Porch Light/);
    });
  });
});
