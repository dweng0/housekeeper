import { describe, it, expect, vi } from "vitest";
import type {
  Automation,
  AutomationRepository,
  ClassifiedIntent,
  ConfigRepository,
  Device,
  DeviceGateway,
  DeviceRepository,
  IntentClassifier,
  MemoryStore,
  QueryResponder,
  ResponseAudioCache,
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
  const streamBuffers = new Map<string, Buffer[]>();
  const hub: VoiceNodeHub = {
    start: vi.fn(),
    stop: vi.fn(),
    onUtterance: (h) => { handler = h; },
    pushUtterance: vi.fn(),
    sendTts: vi.fn(),
    sendTtsStream: vi.fn(async (nodeId, chunks) => {
      const token = `stream-${Math.random()}`;
      const buffered: Buffer[] = [];
      for await (const chunk of chunks) {
        buffered.push(chunk);
      }
      streamBuffers.set(`${nodeId}:${token}`, buffered);
      return token;
    }),
    sendConfig: vi.fn(),
    getNode: vi.fn(),
    getConnectedNodes: vi.fn(() => []),
    getStreamBuffer: vi.fn((nodeId, token) => streamBuffers.get(`${nodeId}:${token}`) ?? null),
  };
  const emit = (text: string, nodeId = TEST_NODE_ID) => handler?.(nodeId, text);
  return { hub, emit, streamBuffers };
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

function makeQueryResponder(reply: string): QueryResponder {
  return { respond: async () => reply };
}

function makeGateway() {
  const published: { topic: string; payload: string }[] = [];
  const gateway: DeviceGateway = {
    publish: vi.fn(async (topic, payload) => { published.push({ topic, payload }); }),
    subscribe: vi.fn(),
  };
  return { gateway, published };
}

function makeResponseAudioCache(stopConfirmationAudio: Buffer | null = null): ResponseAudioCache {
  return {
    lookup: vi.fn(async () => null),
    lookupNotFound: vi.fn(async () => null),
    lookupStopConfirmation: vi.fn(async () => stopConfirmationAudio),
  };
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

  it("speaks fallback reply and saves nothing for unknown intent", async () => {
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
    await vi.waitFor(() => expect(spoken).toHaveLength(1));

    expect(automationRepo.saved).toHaveLength(0);
    expect(spoken[0].text).toMatch(/didn't understand|repeat|rephrase/i);
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

    describe("ResponseAudioCache", () => {
      function makeAudioCache(buffer: Buffer | null, notFoundBuffer: Buffer | null = null): ResponseAudioCache {
        return {
          lookup: vi.fn(async () => buffer),
          lookupNotFound: vi.fn(async () => notFoundBuffer),
          lookupStopConfirmation: vi.fn(async () => null),
        };
      }

      it("cache hit: sends buffer via hub.sendTts and skips speechOutput.speak", async () => {
        const { hub, emit } = makeVoiceNodeHub();
        const { output, spoken } = makeSpeechOutput();
        const { gateway } = makeGateway();
        const cachedBuffer = Buffer.from("fake-wav");
        const cache = makeAudioCache(cachedBuffer);
        const intent: ClassifiedIntent = { type: "device-control", deviceLabel: "Porch Light", command: "on", response: "The porch light is now on." };

        const service = makeVoiceAutomationService({
          voiceNodeHub: hub,
          systemName: "housekeeper",
          classifier: makeClassifier(intent),
          devices: makeDeviceRepo([actuator]),
          automations: makeAutomationRepo(),
          speechOutput: output,
          gateway,
          responseAudioCache: cache,
        });

        service.start();
        emit("housekeeper turn on the porch light");
        await vi.waitFor(() => expect(hub.sendTts).toHaveBeenCalledOnce());

        expect(hub.sendTts).toHaveBeenCalledWith(TEST_NODE_ID, cachedBuffer);
        expect(spoken).toHaveLength(0);
      });

      it("cache miss: falls through to speechOutput.speak", async () => {
        const { hub, emit } = makeVoiceNodeHub();
        const { output, spoken } = makeSpeechOutput();
        const { gateway } = makeGateway();
        const cache = makeAudioCache(null);
        const intent: ClassifiedIntent = { type: "device-control", deviceLabel: "Porch Light", command: "on", response: "The porch light is now on." };

        const service = makeVoiceAutomationService({
          voiceNodeHub: hub,
          systemName: "housekeeper",
          classifier: makeClassifier(intent),
          devices: makeDeviceRepo([actuator]),
          automations: makeAutomationRepo(),
          speechOutput: output,
          gateway,
          responseAudioCache: cache,
        });

        service.start();
        emit("housekeeper turn on the porch light");
        await vi.waitFor(() => expect(spoken).toHaveLength(1));

        expect(hub.sendTts).not.toHaveBeenCalled();
        expect(spoken[0].text).toBe("The porch light is now on.");
      });

      it("no responseAudioCache dep: behaves as miss, speaks via speechOutput", async () => {
        const { hub, emit } = makeVoiceNodeHub();
        const { output, spoken } = makeSpeechOutput();
        const { gateway } = makeGateway();
        const intent: ClassifiedIntent = { type: "device-control", deviceLabel: "Porch Light", command: "on", response: "The porch light is now on." };

        const service = makeVoiceAutomationService({
          voiceNodeHub: hub,
          systemName: "housekeeper",
          classifier: makeClassifier(intent),
          devices: makeDeviceRepo([actuator]),
          automations: makeAutomationRepo(),
          speechOutput: output,
          gateway,
          // no responseAudioCache
        });

        service.start();
        emit("housekeeper turn on the porch light");
        await vi.waitFor(() => expect(spoken).toHaveLength(1));

        expect(hub.sendTts).not.toHaveBeenCalled();
        expect(spoken[0].text).toBe("The porch light is now on.");
      });

      it("unknown device + cache hit: sends not-found buffer via hub.sendTts, skips speechOutput.speak", async () => {
        const { hub, emit } = makeVoiceNodeHub();
        const { output, spoken } = makeSpeechOutput();
        const { gateway } = makeGateway();
        const notFoundBuffer = Buffer.from("not-found-audio");
        const cache = makeAudioCache(null, notFoundBuffer);
        const intent: ClassifiedIntent = { type: "device-control", deviceLabel: "Nonexistent Light", command: "on" };

        const service = makeVoiceAutomationService({
          voiceNodeHub: hub,
          systemName: "housekeeper",
          classifier: makeClassifier(intent),
          devices: makeDeviceRepo([actuator]),
          automations: makeAutomationRepo(),
          speechOutput: output,
          gateway,
          responseAudioCache: cache,
        });

        service.start();
        emit("housekeeper turn on the nonexistent light");
        await vi.waitFor(() => expect(hub.sendTts).toHaveBeenCalledOnce());

        expect(hub.sendTts).toHaveBeenCalledWith(TEST_NODE_ID, notFoundBuffer);
        expect(spoken).toHaveLength(0);
      });

      it("unknown device + cache miss: falls through to speechOutput.speak", async () => {
        const { hub, emit } = makeVoiceNodeHub();
        const { output, spoken } = makeSpeechOutput();
        const { gateway } = makeGateway();
        const cache = makeAudioCache(null, null);
        const intent: ClassifiedIntent = { type: "device-control", deviceLabel: "Nonexistent Light", command: "on" };

        const service = makeVoiceAutomationService({
          voiceNodeHub: hub,
          systemName: "housekeeper",
          classifier: makeClassifier(intent),
          devices: makeDeviceRepo([actuator]),
          automations: makeAutomationRepo(),
          speechOutput: output,
          gateway,
          responseAudioCache: cache,
        });

        service.start();
        emit("housekeeper turn on the nonexistent light");
        await vi.waitFor(() => expect(spoken).toHaveLength(1));

        expect(hub.sendTts).not.toHaveBeenCalled();
        expect(spoken[0].text).toMatch(/Nonexistent Light/i);
      });
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

      expect(classifySpy).toHaveBeenCalledWith(expect.objectContaining({ utterance: "what time is it", residentId: "household", memories: [] }));
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
        utterance: "turn on lights",
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

  describe("Intent Confidence routing", () => {
    function makeAudioCache(buffer: Buffer | null): ResponseAudioCache {
      return {
        lookup: vi.fn(async () => buffer),
        lookupNotFound: vi.fn(async () => null),
        lookupStopConfirmation: vi.fn(async () => null),
      };
    }

    it("low confidence device-control: speaks hedgedResponse via live TTS, skips cache", async () => {
      const { hub, emit } = makeVoiceNodeHub();
      const { output, spoken } = makeSpeechOutput();
      const { gateway } = makeGateway();
      const cachedBuffer = Buffer.from("fake-wav");
      const cache = makeAudioCache(cachedBuffer);
      const intent: ClassifiedIntent = {
        type: "device-control",
        deviceLabel: "Porch Light",
        command: "on",
        response: "The porch light is now on.",
        hedgedResponse: "I think you're asking me to turn on the porch light — done.",
        intentConfidence: 0.4,
      };

      const service = makeVoiceAutomationService({
        voiceNodeHub: hub,
        systemName: "housekeeper",
        classifier: makeClassifier(intent),
        devices: makeDeviceRepo([actuator]),
        automations: makeAutomationRepo(),
        speechOutput: output,
        gateway,
        responseAudioCache: cache,
      });

      service.start();
      emit("housekeeper maybe porch light on?");
      await vi.waitFor(() => expect(spoken).toHaveLength(1));

      expect(hub.sendTts).not.toHaveBeenCalled();
      expect(spoken[0].text).toBe("I think you're asking me to turn on the porch light — done.");
    });

    it("high confidence device-control: uses cache as normal", async () => {
      const { hub, emit } = makeVoiceNodeHub();
      const { output, spoken } = makeSpeechOutput();
      const { gateway } = makeGateway();
      const cachedBuffer = Buffer.from("fake-wav");
      const cache = makeAudioCache(cachedBuffer);
      const intent: ClassifiedIntent = {
        type: "device-control",
        deviceLabel: "Porch Light",
        command: "on",
        response: "The porch light is now on.",
        hedgedResponse: "I think you're asking me to turn on the porch light — done.",
        intentConfidence: 0.9,
      };

      const service = makeVoiceAutomationService({
        voiceNodeHub: hub,
        systemName: "housekeeper",
        classifier: makeClassifier(intent),
        devices: makeDeviceRepo([actuator]),
        automations: makeAutomationRepo(),
        speechOutput: output,
        gateway,
        responseAudioCache: cache,
      });

      service.start();
      emit("housekeeper turn on the porch light");
      await vi.waitFor(() => expect(hub.sendTts).toHaveBeenCalledOnce());

      expect(hub.sendTts).toHaveBeenCalledWith(TEST_NODE_ID, cachedBuffer);
      expect(spoken).toHaveLength(0);
    });

    it("low confidence query: speaks hedgedResponse", async () => {
      const { hub, emit } = makeVoiceNodeHub();
      const { output, spoken } = makeSpeechOutput();
      const intent: ClassifiedIntent = {
        type: "query",
        query: "weather?",
        response: "I don't have live weather data.",
        hedgedResponse: "I think you're asking about the weather — I don't have live data right now.",
        intentConfidence: 0.5,
      };

      const service = makeVoiceAutomationService({
        voiceNodeHub: hub,
        systemName: "housekeeper",
        classifier: makeClassifier(intent),
        devices: makeDeviceRepo([]),
        automations: makeAutomationRepo(),
        speechOutput: output,
      });

      service.start();
      emit("housekeeper weather something");
      await vi.waitFor(() => expect(spoken).toHaveLength(1));

      expect(spoken[0].text).toBe("I think you're asking about the weather — I don't have live data right now.");
    });

    it("no intentConfidence field: treats as high confidence (backward compat)", async () => {
      const { hub, emit } = makeVoiceNodeHub();
      const { output, spoken } = makeSpeechOutput();
      const { gateway } = makeGateway();
      const intent: ClassifiedIntent = {
        type: "device-control",
        deviceLabel: "Porch Light",
        command: "on",
        response: "The porch light is now on.",
      };

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
      await vi.waitFor(() => expect(spoken).toHaveLength(1));

      expect(spoken[0].text).toBe("The porch light is now on.");
    });
  });

  describe("Conversation Context", () => {
    it("context stays open indefinitely; closes only on new Directed Question", async () => {
      const { hub, emit } = makeVoiceNodeHub();
      const { output, spoken } = makeSpeechOutput();
      const { gateway } = makeGateway();

      const firstIntent: ClassifiedIntent = {
        type: "device-control",
        deviceLabel: "Porch Light",
        command: "on",
        response: "Done — porch light is on.",
      };
      let call = 0;
      const classifySpy = vi.fn().mockImplementation(async () => {
        if (call++ === 0) return firstIntent;
        return { type: "query", response: "It is off." };
      });

      const mockConfig: ConfigRepository = {
        get: async () => ({ autoDiscovery: false }),
        save: async () => {},
      };

      const service = makeVoiceAutomationService({
        voiceNodeHub: hub,
        systemName: "housekeeper",
        classifier: { classify: classifySpy },
        devices: makeDeviceRepo([actuator]),
        automations: makeAutomationRepo(),
        speechOutput: output,
        gateway,
        config: mockConfig,
      });

      service.start();
      emit("housekeeper turn on the porch light");
      await vi.waitFor(() => expect(spoken).toHaveLength(1));
      await Promise.resolve();

      // Follow-up after delay — context still open, should classify
      emit("is it on?");
      await vi.waitFor(() => expect(spoken).toHaveLength(2));

      // Both calls classified: first Directed Question, then follow-up
      expect(classifySpy).toHaveBeenCalledTimes(2);
    });

    it("follow-up utterance without system name is discarded when context is closed", async () => {
      const { hub, emit } = makeVoiceNodeHub();
      const { output } = makeSpeechOutput();
      const classifySpy = vi.fn().mockResolvedValue({ type: "unknown" } as ClassifiedIntent);

      const service = makeVoiceAutomationService({
        voiceNodeHub: hub,
        systemName: "housekeeper",
        classifier: { classify: classifySpy },
        devices: makeDeviceRepo([]),
        automations: makeAutomationRepo(),
        speechOutput: output,
      });

      service.start();
      // No prior directed question — context is closed
      emit("actually turn it off");
      await new Promise((r) => setTimeout(r, 20));

      expect(classifySpy).not.toHaveBeenCalled();
    });

    it("new directed question resets context so it does not carry prior history", async () => {
      const { hub, emit } = makeVoiceNodeHub();
      const { output, spoken } = makeSpeechOutput();
      const { gateway } = makeGateway();

      const firstIntent: ClassifiedIntent = {
        type: "device-control",
        deviceLabel: "Porch Light",
        command: "on",
        response: "Done — porch light is on.",
      };
      let call = 0;
      const classifySpy = vi.fn().mockImplementation(async () => call++ === 0 ? firstIntent : { type: "unknown" });

      const service = makeVoiceAutomationService({
        voiceNodeHub: hub,
        systemName: "housekeeper",
        classifier: { classify: classifySpy },
        devices: makeDeviceRepo([actuator]),
        automations: makeAutomationRepo(),
        speechOutput: output,
        gateway,
      });

      service.start();
      emit("housekeeper turn on the porch light");
      await vi.waitFor(() => expect(spoken).toHaveLength(1));
      await Promise.resolve();

      // Second directed question — context resets before classify
      emit("housekeeper turn off the porch light");
      await vi.waitFor(() => expect(classifySpy).toHaveBeenCalledTimes(2));

      expect(classifySpy.mock.calls[1][0]).not.toHaveProperty("conversationHistory", expect.arrayContaining([
        expect.objectContaining({ role: "user" }),
      ]));
      // conversationHistory should be absent or empty
      const secondCallHistory = classifySpy.mock.calls[1][0].conversationHistory;
      expect(!secondCallHistory || secondCallHistory.length === 0).toBe(true);
    });

    it("set-resident intent resets context so subsequent ambient utterances are discarded", async () => {
      const { hub, emit } = makeVoiceNodeHub();
      const { output, spoken } = makeSpeechOutput();

      const setResidentIntent: ClassifiedIntent = {
        type: "set-resident",
        residentName: "Jay",
        response: "Hi Jay!",
      };
      let call = 0;
      const classifySpy = vi.fn().mockImplementation(async () => call++ === 0 ? setResidentIntent : { type: "unknown" });

      const service = makeVoiceAutomationService({
        voiceNodeHub: hub,
        systemName: "housekeeper",
        classifier: { classify: classifySpy },
        devices: makeDeviceRepo([]),
        automations: makeAutomationRepo(),
        speechOutput: output,
      });

      service.start();
      // First, a directed question that WOULD open context — but set-resident resets it
      emit("housekeeper this is Jay");
      await vi.waitFor(() => expect(spoken).toHaveLength(1));
      await Promise.resolve();

      // Ambient utterance — context should be closed due to set-resident reset
      emit("do something else");
      await new Promise((r) => setTimeout(r, 20));

      expect(classifySpy).toHaveBeenCalledTimes(1);
    });

    it("follow-up utterance (no system name, context open) is classified with conversationHistory", async () => {
      const { hub, emit } = makeVoiceNodeHub();
      const { output, spoken } = makeSpeechOutput();
      const { gateway } = makeGateway();

      const firstIntent: ClassifiedIntent = {
        type: "device-control",
        deviceLabel: "Porch Light",
        command: "on",
        response: "Done — porch light is on.",
      };
      let call = 0;
      const classifySpy = vi.fn().mockImplementation(async () => call++ === 0 ? firstIntent : { type: "unknown" });

      const service = makeVoiceAutomationService({
        voiceNodeHub: hub,
        systemName: "housekeeper",
        classifier: { classify: classifySpy },
        devices: makeDeviceRepo([actuator]),
        automations: makeAutomationRepo(),
        speechOutput: output,
        gateway,
      });

      service.start();
      emit("housekeeper turn on the porch light");
      await vi.waitFor(() => expect(spoken).toHaveLength(1));
      await Promise.resolve(); // flush microtasks so ctx.addTurn runs

      emit("actually turn it off");
      await vi.waitFor(() => expect(classifySpy).toHaveBeenCalledTimes(2));

      expect(classifySpy.mock.calls[1][0]).toMatchObject({
        utterance: "actually turn it off",
        conversationHistory: [
          { role: "user", content: "turn on the porch light" },
          { role: "assistant", content: "Done — porch light is on." },
        ],
      });
    });

    describe("Conversation Finished signal", () => {
      const DEFAULT_THRESHOLD = 0.5;

      it("high conversationFinished (>= threshold) closes context after response", async () => {
        const { hub, emit } = makeVoiceNodeHub();
        const { output, spoken } = makeSpeechOutput();
        const { gateway } = makeGateway();

        const firstIntent: ClassifiedIntent = {
          type: "device-control",
          deviceLabel: "Porch Light",
          command: "on",
          response: "Done — porch light is on.",
        };
        let call = 0;
        const classifySpy = vi.fn().mockImplementation(async () => {
          if (call++ === 0) return firstIntent;
          return { type: "query", response: "Let me know if you need anything else.", conversationFinished: 0.8 };
        });

        const mockConfig: ConfigRepository = {
          get: async () => ({ autoDiscovery: false, conversationFinishedThreshold: DEFAULT_THRESHOLD }),
          save: async () => {},
        };

        const service = makeVoiceAutomationService({
          voiceNodeHub: hub,
          systemName: "housekeeper",
          classifier: { classify: classifySpy },
          devices: makeDeviceRepo([actuator]),
          automations: makeAutomationRepo(),
          speechOutput: output,
          gateway,
          config: mockConfig,
        });

        service.start();
        emit("housekeeper turn on the porch light");
        await vi.waitFor(() => expect(spoken).toHaveLength(1));
        await Promise.resolve();

        emit("thanks");
        await vi.waitFor(() => expect(spoken).toHaveLength(2));
        await Promise.resolve();

        emit("what else");
        await new Promise((r) => setTimeout(r, 50));

        expect(classifySpy).toHaveBeenCalledTimes(2);
      });

      it("low conversationFinished (< threshold) keeps context open", async () => {
        const { hub, emit } = makeVoiceNodeHub();
        const { output, spoken } = makeSpeechOutput();
        const { gateway } = makeGateway();

        const firstIntent: ClassifiedIntent = {
          type: "device-control",
          deviceLabel: "Porch Light",
          command: "on",
          response: "Done — porch light is on.",
        };
        let call = 0;
        const classifySpy = vi.fn().mockImplementation(async () => {
          if (call++ === 0) return firstIntent;
          if (call === 1) return { type: "query", response: "What color?", conversationFinished: 0.3 };
          return { type: "query", response: "Blue." };
        });

        const mockConfig: ConfigRepository = {
          get: async () => ({ autoDiscovery: false, conversationFinishedThreshold: DEFAULT_THRESHOLD }),
          save: async () => {},
        };

        const service = makeVoiceAutomationService({
          voiceNodeHub: hub,
          systemName: "housekeeper",
          classifier: { classify: classifySpy },
          devices: makeDeviceRepo([actuator]),
          automations: makeAutomationRepo(),
          speechOutput: output,
          gateway,
          config: mockConfig,
        });

        service.start();
        emit("housekeeper turn on the porch light");
        await vi.waitFor(() => expect(spoken).toHaveLength(1));
        await Promise.resolve();

        emit("what about the other one");
        await vi.waitFor(() => expect(spoken).toHaveLength(2));
        await Promise.resolve();

        emit("blue please");
        await vi.waitFor(() => expect(classifySpy).toHaveBeenCalledTimes(3));

        expect(classifySpy.mock.calls[2][0].conversationHistory).toBeDefined();
        expect(classifySpy.mock.calls[2][0].conversationHistory!.length).toBeGreaterThan(0);
      });

      it("missing conversationFinished keeps context open (treated as 0)", async () => {
        const { hub, emit } = makeVoiceNodeHub();
        const { output, spoken } = makeSpeechOutput();
        const { gateway } = makeGateway();

        const firstIntent: ClassifiedIntent = {
          type: "device-control",
          deviceLabel: "Porch Light",
          command: "on",
          response: "Done — porch light is on.",
        };
        let call = 0;
        const classifySpy = vi.fn().mockImplementation(async () => {
          if (call++ === 0) return firstIntent;
          return { type: "query", response: "Okay." };
        });

        const mockConfig: ConfigRepository = {
          get: async () => ({ autoDiscovery: false, conversationFinishedThreshold: DEFAULT_THRESHOLD }),
          save: async () => {},
        };

        const service = makeVoiceAutomationService({
          voiceNodeHub: hub,
          systemName: "housekeeper",
          classifier: { classify: classifySpy },
          devices: makeDeviceRepo([actuator]),
          automations: makeAutomationRepo(),
          speechOutput: output,
          gateway,
          config: mockConfig,
        });

        service.start();
        emit("housekeeper turn on the porch light");
        await vi.waitFor(() => expect(spoken).toHaveLength(1));
        await Promise.resolve();

        emit("thanks");
        await vi.waitFor(() => expect(spoken).toHaveLength(2));
        await Promise.resolve();

        emit("another thing");
        await vi.waitFor(() => expect(classifySpy).toHaveBeenCalledTimes(3));
      });

      it("Directed Question does not expect conversationFinished (backward compat)", async () => {
        const { hub, emit } = makeVoiceNodeHub();
        const { output, spoken } = makeSpeechOutput();
        const { gateway } = makeGateway();

        const firstIntent: ClassifiedIntent = {
          type: "device-control",
          deviceLabel: "Porch Light",
          command: "on",
          response: "Done — porch light is on.",
        };
        let call = 0;
        const classifySpy = vi.fn().mockImplementation(async () => {
          call++;
          return firstIntent;
        });

        const mockConfig: ConfigRepository = {
          get: async () => ({ autoDiscovery: false, conversationFinishedThreshold: DEFAULT_THRESHOLD }),
          save: async () => {},
        };

        const service = makeVoiceAutomationService({
          voiceNodeHub: hub,
          systemName: "housekeeper",
          classifier: { classify: classifySpy },
          devices: makeDeviceRepo([actuator]),
          automations: makeAutomationRepo(),
          speechOutput: output,
          gateway,
          config: mockConfig,
        });

        service.start();
        emit("housekeeper turn on the porch light");
        await vi.waitFor(() => expect(spoken).toHaveLength(1));
        await Promise.resolve();

        emit("housekeeper turn off the porch light");
        await vi.waitFor(() => expect(classifySpy).toHaveBeenCalledTimes(2));

        expect(classifySpy.mock.calls[1][0].conversationHistory).toBeFalsy();
      });
    });
  });

  describe("query intent", () => {
    it("speaks the QueryResponder reply when intent is query", async () => {
      const { hub, emit } = makeVoiceNodeHub();
      const { output, spoken } = makeSpeechOutput();
      const intent: ClassifiedIntent = { type: "query", query: "What makes plants green?" };

      const service = makeVoiceAutomationService({
        voiceNodeHub: hub,
        systemName: "housekeeper",
        classifier: makeClassifier(intent),
        devices: makeDeviceRepo([]),
        automations: makeAutomationRepo(),
        speechOutput: output,
        queryResponder: makeQueryResponder("Chlorophyll absorbs sunlight."),
      });

      service.start();
      emit("housekeeper what makes plants green?");
      await vi.waitFor(() => expect(spoken).toHaveLength(1));

      expect(spoken[0].text).toBe("Chlorophyll absorbs sunlight.");
      expect(spoken[0].nodeId).toBe(TEST_NODE_ID);
    });

    it("speaks inline response directly without calling queryResponder", async () => {
      const { hub, emit } = makeVoiceNodeHub();
      const { output, spoken } = makeSpeechOutput();
      const respondSpy = vi.fn().mockResolvedValue("should not be called");
      const intent: ClassifiedIntent = { type: "query", query: "what temperature is the sun?", response: "The sun's surface is about 5,500°C." };

      const service = makeVoiceAutomationService({
        voiceNodeHub: hub,
        systemName: "housekeeper",
        classifier: makeClassifier(intent),
        devices: makeDeviceRepo([]),
        automations: makeAutomationRepo(),
        speechOutput: output,
        queryResponder: { respond: respondSpy },
      });

      service.start();
      emit("housekeeper what temperature is the sun?");
      await vi.waitFor(() => expect(spoken).toHaveLength(1));

      expect(spoken[0].text).toBe("The sun's surface is about 5,500°C.");
      expect(respondSpy).not.toHaveBeenCalled();
    });

    it("passes memories and location to QueryResponder", async () => {
      const { hub: hub2, emit } = makeVoiceNodeHub();
      const { output } = makeSpeechOutput();
      const intent: ClassifiedIntent = { type: "query", query: "Do I have any pets?" };
      const respondSpy = vi.fn().mockResolvedValue("Yes, you have a cat.");
      const memoryStore = makeMemoryStore();
      const session = makeResidentSession();
      session.setActive("Jay");
      await memoryStore.store("Jay", "Jay has a cat named Whiskers");
      hub2.getNode = vi.fn().mockReturnValue({ id: TEST_NODE_ID, location: "kitchen", capabilities: ["mic"], confirmed: true, transport: "websocket" as const, label: "kitchen" });

      const service = makeVoiceAutomationService({
        voiceNodeHub: hub2,
        systemName: "housekeeper",
        classifier: makeClassifier(intent),
        devices: makeDeviceRepo([]),
        automations: makeAutomationRepo(),
        speechOutput: output,
        queryResponder: { respond: respondSpy },
        session,
        memoryStore,
      });

      service.start();
      emit("housekeeper do I have any pets?");
      await vi.waitFor(() => expect(respondSpy).toHaveBeenCalledOnce());

      expect(respondSpy).toHaveBeenCalledWith(
        "Do I have any pets?",
        expect.objectContaining({
          memories: expect.arrayContaining(["Jay has a cat named Whiskers"]),
          location: "kitchen",
        }),
      );
    });
  });

  describe("ambient utterance in open context", () => {
    it("adds ambient turn to context so next ambient classify call sees it in history", async () => {
      const { hub, emit } = makeVoiceNodeHub();
      const { output, spoken } = makeSpeechOutput();
      const { gateway } = makeGateway();

      let call = 0;
      const classifySpy = vi.fn().mockImplementation(async (): Promise<ClassifiedIntent> => {
        const n = call++;
        if (n === 0) return { type: "device-control", deviceLabel: "Porch Light", command: "on", response: "Done." };
        return { type: "query", response: `reply ${n}` };
      });

      const service = makeVoiceAutomationService({
        voiceNodeHub: hub,
        systemName: "housekeeper",
        classifier: { classify: classifySpy },
        devices: makeDeviceRepo([actuator]),
        automations: makeAutomationRepo(),
        speechOutput: output,
        gateway,
      });

      service.start();
      emit("housekeeper turn on the porch light");
      await vi.waitFor(() => expect(spoken).toHaveLength(1));
      await Promise.resolve();

      emit("oh you can go there by train");
      await vi.waitFor(() => expect(spoken).toHaveLength(2));
      await Promise.resolve();

      emit("and it's quite fast too");
      await vi.waitFor(() => expect(classifySpy).toHaveBeenCalledTimes(3));

      const thirdCallHistory = classifySpy.mock.calls[2][0].conversationHistory;
      expect(thirdCallHistory).toContainEqual({ role: "user", content: "oh you can go there by train" });
      expect(thirdCallHistory).toContainEqual({ role: "assistant", content: "reply 1" });
    });

    it("unknown ambient utterance keeps context open (rolling window)", async () => {
      const { hub, emit } = makeVoiceNodeHub();
      const { output, spoken } = makeSpeechOutput();
      const { gateway } = makeGateway();

      const mockConfig: ConfigRepository = {
        get: async () => ({ autoDiscovery: false, conversationContextTimeoutSeconds: 0.3 }),
        save: async () => {},
      };

      let call = 0;
      const classifySpy = vi.fn().mockImplementation(async (): Promise<ClassifiedIntent> => {
        const n = call++;
        if (n === 0) return { type: "device-control", deviceLabel: "Porch Light", command: "on", response: "Done." };
        if (n === 1) return { type: "unknown" }; // ambient — resets timer via touch
        return { type: "query", response: "Still here." };
      });

      const service = makeVoiceAutomationService({
        voiceNodeHub: hub,
        systemName: "housekeeper",
        classifier: { classify: classifySpy },
        devices: makeDeviceRepo([actuator]),
        automations: makeAutomationRepo(),
        speechOutput: output,
        gateway,
        config: mockConfig,
      });

      service.start();
      emit("housekeeper turn on the porch light");
      await vi.waitFor(() => expect(spoken).toHaveLength(1));
      await Promise.resolve();

      // Wait 200ms — near expiry (300ms window) but still open
      await new Promise((r) => setTimeout(r, 200));

      // Ambient unknown — touch resets timer (new expiry: now + 300ms)
      emit("some ambient noise");
      await vi.waitFor(() => expect(classifySpy).toHaveBeenCalledTimes(2));
      await Promise.resolve();

      // Wait another 200ms — original window expired at ~T+300ms; touch extended it; we're at ~T+400ms
      await new Promise((r) => setTimeout(r, 200));

      emit("is anyone there?");
      await vi.waitFor(() => expect(spoken).toHaveLength(2));

      expect(spoken[1].text).toBe("Still here.");
    });

    it("does not speak when ambient utterance classifies as unknown", async () => {
      const { hub, emit } = makeVoiceNodeHub();
      const { output, spoken } = makeSpeechOutput();
      const { gateway } = makeGateway();

      let call = 0;
      const classifySpy = vi.fn().mockImplementation(async (): Promise<ClassifiedIntent> => {
        if (call++ === 0) {
          return { type: "device-control", deviceLabel: "Porch Light", command: "on", response: "Done." };
        }
        return { type: "unknown" };
      });

      const service = makeVoiceAutomationService({
        voiceNodeHub: hub,
        systemName: "housekeeper",
        classifier: { classify: classifySpy },
        devices: makeDeviceRepo([actuator]),
        automations: makeAutomationRepo(),
        speechOutput: output,
        gateway,
      });

      service.start();
      emit("housekeeper turn on the porch light");
      await vi.waitFor(() => expect(spoken).toHaveLength(1));
      await Promise.resolve();

      emit("mumble mumble");
      await new Promise((r) => setTimeout(r, 30));

      expect(spoken).toHaveLength(1);
    });

    it("speaks query response when context is open", async () => {
      const { hub, emit } = makeVoiceNodeHub();
      const { output, spoken } = makeSpeechOutput();
      const { gateway } = makeGateway();

      let call = 0;
      const classifySpy = vi.fn().mockImplementation(async (): Promise<ClassifiedIntent> => {
        if (call++ === 0) {
          return { type: "device-control", deviceLabel: "Porch Light", command: "on", response: "Done." };
        }
        return { type: "query", response: "Yes, you can take the Eurostar." };
      });

      const service = makeVoiceAutomationService({
        voiceNodeHub: hub,
        systemName: "housekeeper",
        classifier: { classify: classifySpy },
        devices: makeDeviceRepo([actuator]),
        automations: makeAutomationRepo(),
        speechOutput: output,
        gateway,
      });

      service.start();
      emit("housekeeper turn on the porch light");
      await vi.waitFor(() => expect(spoken).toHaveLength(1));
      await Promise.resolve();

      emit("oh you can go there by train");
      await vi.waitFor(() => expect(spoken).toHaveLength(2));

      expect(spoken[1].text).toBe("Yes, you can take the Eurostar.");
      expect(spoken[1].nodeId).toBe(TEST_NODE_ID);
    });

    it("speaks clarifyingQuestion for low-confidence follow-up instead of acting", async () => {
      const { hub, emit } = makeVoiceNodeHub();
      const { output, spoken } = makeSpeechOutput();
      const { gateway, published } = makeGateway();

      let call = 0;
      const classifySpy = vi.fn().mockImplementation(async (): Promise<ClassifiedIntent> => {
        if (call++ === 0) {
          return { type: "device-control", deviceLabel: "Porch Light", command: "on", response: "Done.", intentConfidence: 0.95 };
        }
        // Follow-up with low confidence, LLM returns clarifyingQuestion
        return {
          type: "device-control",
          deviceLabel: "Kitchen Light",
          command: "on",
          clarifyingQuestion: "Did you mean kitchen light or bedroom light?",
          intentConfidence: 0.55,
        };
      });

      const service = makeVoiceAutomationService({
        voiceNodeHub: hub,
        systemName: "housekeeper",
        classifier: { classify: classifySpy },
        devices: makeDeviceRepo([actuator]),
        automations: makeAutomationRepo(),
        speechOutput: output,
        gateway,
      });

      service.start();
      emit("housekeeper turn on the porch light");
      await vi.waitFor(() => expect(spoken).toHaveLength(1));
      await Promise.resolve();

      expect(published).toHaveLength(1); // device was controlled

      emit("turn on the light");
      await vi.waitFor(() => expect(spoken).toHaveLength(2));

      // Should ask for clarification instead of controlling the device
      expect(spoken[1].text).toBe("Did you mean kitchen light or bedroom light?");
      expect(published).toHaveLength(1); // device was NOT controlled
    });
  });

  describe("TTS stream interruption orchestration (issue #59)", () => {
    describe("Stream Lifecycle Orchestration (Phase 1: wrapper method)", () => {
      it("TRACER: sendTtsStream returns token and caches stream", async () => {
        const { hub, streamBuffers } = makeVoiceNodeHub();
        const { output } = makeSpeechOutput();

        const service = makeVoiceAutomationService({
          voiceNodeHub: hub,
          systemName: "housekeeper",
          classifier: makeClassifier({ type: "unknown" }),
          devices: makeDeviceRepo([]),
          automations: makeAutomationRepo(),
          speechOutput: output,
        });

        service.start();

        // Create async iterable of test chunks
        async function* testChunks() {
          yield Buffer.from("chunk1");
          yield Buffer.from("chunk2");
        }

        const token = await service.sendTtsStream(TEST_NODE_ID, testChunks());

        // Verify token returned
        expect(token).toBeDefined();
        expect(typeof token).toBe("string");

        // Verify stream was cached in hub (observable behavior)
        const cached = (hub as any).getStreamBuffer(TEST_NODE_ID, token);
        expect(cached).toBeDefined();
        expect(cached).toHaveLength(2);
        expect(cached[0].toString()).toBe("chunk1");
        expect(cached[1].toString()).toBe("chunk2");
      });
    });

    describe("Stream Lifecycle Orchestration (Phase 2: replay on no response)", () => {
      it("on no response: fetches cached stream and replays via sendTtsStream", async () => {
        const { hub, emit } = makeVoiceNodeHub();
        const { output } = makeSpeechOutput();
        const confirmationAudio = Buffer.from("confirmation-wav");

        let replaySendTtsStreamCalls = 0;
        const originalSendTtsStream = hub.sendTtsStream;
        (hub as any).sendTtsStream = vi.fn(async (nodeId: string, chunks: AsyncIterable<Buffer>) => {
          replaySendTtsStreamCalls++;
          return await originalSendTtsStream.call(hub, nodeId, chunks);
        });

        const service = makeVoiceAutomationService({
          voiceNodeHub: hub,
          systemName: "housekeeper",
          classifier: makeClassifier({ type: "unknown" }),
          devices: makeDeviceRepo([]),
          automations: makeAutomationRepo(),
          speechOutput: output,
          responseAudioCache: makeResponseAudioCache(confirmationAudio),
        });

        service.start();

        // Stream some audio
        async function* testChunks() {
          yield Buffer.from("audio1");
          yield Buffer.from("audio2");
        }
        const token = await service.sendTtsStream(TEST_NODE_ID, testChunks());

        // Emit stop-word to trigger interruption
        emit("wait", TEST_NODE_ID);
        await new Promise((r) => setTimeout(r, 50));

        // Emit "no" to trigger replay
        emit("nope", TEST_NODE_ID);
        await new Promise((r) => setTimeout(r, 50));

        // Verify sendTtsStream was called again for replay
        expect((hub.sendTtsStream as any).mock.calls.length).toBeGreaterThan(1);
      });
    });

    describe("Stream Lifecycle Orchestration (Phase 4: timeout handling)", () => {
      it("on timeout: replays stream if still cached", async () => {
        const { hub, emit } = makeVoiceNodeHub();
        const { output } = makeSpeechOutput();
        const confirmationAudio = Buffer.from("confirmation-wav");

        const originalSendTtsStream = hub.sendTtsStream;
        const sendTtsStreamCalls: Array<{ nodeId: string }> = [];
        (hub as any).sendTtsStream = vi.fn(async (nodeId: string, chunks: AsyncIterable<Buffer>) => {
          sendTtsStreamCalls.push({ nodeId });
          return await originalSendTtsStream.call(hub, nodeId, chunks);
        });

        const service = makeVoiceAutomationService({
          voiceNodeHub: hub,
          systemName: "housekeeper",
          classifier: makeClassifier({ type: "unknown" }),
          devices: makeDeviceRepo([]),
          automations: makeAutomationRepo(),
          speechOutput: output,
          responseAudioCache: makeResponseAudioCache(confirmationAudio),
        });

        service.start();

        // Stream some audio
        async function* testChunks() {
          yield Buffer.from("audio1");
          yield Buffer.from("audio2");
        }
        const token = await service.sendTtsStream(TEST_NODE_ID, testChunks());

        // Emit stop-word to trigger interruption
        emit("wait", TEST_NODE_ID);
        await new Promise((r) => setTimeout(r, 50));

        const callsBeforeTimeout = sendTtsStreamCalls.length;

        // Wait for 3-second timeout to fire (plus buffer for processing)
        await new Promise((r) => setTimeout(r, 3150));

        // Verify sendTtsStream was called again for replay
        expect(sendTtsStreamCalls.length).toBeGreaterThan(callsBeforeTimeout);
      }, 10000);
    });

    describe("Stream Lifecycle Orchestration (Integration: full flow)", () => {
      it("completes full interruption flow: stream → stop-word → no → replay", async () => {
        const { hub, emit } = makeVoiceNodeHub();
        const { output, spoken } = makeSpeechOutput();
        const confirmationAudio = Buffer.from("confirmation-wav");

        const originalSendTtsStream = hub.sendTtsStream;
        const sendTtsStreamCalls: number[] = [];
        (hub as any).sendTtsStream = vi.fn(async (nodeId: string, chunks: AsyncIterable<Buffer>) => {
          sendTtsStreamCalls.push(sendTtsStreamCalls.length);
          return await (originalSendTtsStream as any).call(hub, nodeId, chunks);
        });

        const service = makeVoiceAutomationService({
          voiceNodeHub: hub,
          systemName: "housekeeper",
          classifier: makeClassifier({ type: "unknown" }),
          devices: makeDeviceRepo([]),
          automations: makeAutomationRepo(),
          speechOutput: output,
          responseAudioCache: makeResponseAudioCache(confirmationAudio),
        });

        service.start();

        // Stream initial device-control response
        async function* controlResponse() {
          yield Buffer.from("lights");
          yield Buffer.from("on");
        }
        const token = await service.sendTtsStream(TEST_NODE_ID, controlResponse());
        expect(sendTtsStreamCalls.length).toBe(1);

        // User interrupts with stop-word during stream
        emit("wait", TEST_NODE_ID);
        await new Promise((r) => setTimeout(r, 50));

        // Confirmation audio should have been played via sendTts (not sendTtsStream)
        const confirmCalls = (hub.sendTts as any).mock.calls.filter(
          (c: any[]) => c[1]?.equals(confirmationAudio),
        );
        expect(confirmCalls.length).toBeGreaterThan(0);

        // User says "no" to keep the original stream
        emit("no", TEST_NODE_ID);
        await new Promise((r) => setTimeout(r, 100));

        // Verify original stream was replayed (second call to sendTtsStream)
        expect(sendTtsStreamCalls.length).toBeGreaterThan(1);
      });

      it("completes full interruption flow: stream → stop-word → yes → discard", async () => {
        const { hub, emit } = makeVoiceNodeHub();
        const { output, spoken } = makeSpeechOutput();
        const confirmationAudio = Buffer.from("confirmation-wav");

        const originalSendTtsStream = hub.sendTtsStream;
        const sendTtsStreamCalls = [];
        (hub as any).sendTtsStream = vi.fn(async (nodeId: string, chunks: AsyncIterable<Buffer>) => {
          sendTtsStreamCalls.push({});
          return await originalSendTtsStream.call(hub, nodeId, chunks);
        });

        const service = makeVoiceAutomationService({
          voiceNodeHub: hub,
          systemName: "housekeeper",
          classifier: makeClassifier({ type: "unknown" }),
          devices: makeDeviceRepo([]),
          automations: makeAutomationRepo(),
          speechOutput: output,
          responseAudioCache: makeResponseAudioCache(confirmationAudio),
        });

        service.start();

        // Stream initial response
        async function* controlResponse() {
          yield Buffer.from("lights");
          yield Buffer.from("on");
        }
        const token = await service.sendTtsStream(TEST_NODE_ID, controlResponse());

        const callsBeforeInterrupt = sendTtsStreamCalls.length;

        // User interrupts with stop-word
        emit("wait", TEST_NODE_ID);
        await new Promise((r) => setTimeout(r, 50));

        // User says "yes" to discard
        emit("yes", TEST_NODE_ID);
        await new Promise((r) => setTimeout(r, 50));

        // Verify no replay occurred (same number of calls)
        expect(sendTtsStreamCalls.length).toBe(callsBeforeInterrupt);
      });
    });

    describe("Stream Lifecycle Orchestration (Phase 3: discard on yes response)", () => {
      it("on yes response: discards stream token, does not replay", async () => {
        const { hub, emit } = makeVoiceNodeHub();
        const { output } = makeSpeechOutput();
        const confirmationAudio = Buffer.from("confirmation-wav");

        const originalSendTtsStream = hub.sendTtsStream;
        const sendTtsStreamCalls: Array<{ nodeId: string }> = [];
        (hub as any).sendTtsStream = vi.fn(async (nodeId: string, chunks: AsyncIterable<Buffer>) => {
          sendTtsStreamCalls.push({ nodeId });
          return await originalSendTtsStream.call(hub, nodeId, chunks);
        });

        const service = makeVoiceAutomationService({
          voiceNodeHub: hub,
          systemName: "housekeeper",
          classifier: makeClassifier({ type: "unknown" }),
          devices: makeDeviceRepo([]),
          automations: makeAutomationRepo(),
          speechOutput: output,
          responseAudioCache: makeResponseAudioCache(confirmationAudio),
        });

        service.start();

        // Stream some audio
        async function* testChunks() {
          yield Buffer.from("audio1");
          yield Buffer.from("audio2");
        }
        const token = await service.sendTtsStream(TEST_NODE_ID, testChunks());

        // Emit stop-word to trigger interruption
        emit("wait", TEST_NODE_ID);
        await new Promise((r) => setTimeout(r, 50));

        const callsBeforeYes = sendTtsStreamCalls.length;

        // Emit "yes" to discard (should NOT replay)
        emit("yes", TEST_NODE_ID);
        await new Promise((r) => setTimeout(r, 50));

        // Verify sendTtsStream was NOT called again (no replay)
        expect(sendTtsStreamCalls.length).toBe(callsBeforeYes);
      });
    });

    it("TRACER: plays confirmation audio when stop-word heard during ambient listening", async () => {
      const { hub, emit } = makeVoiceNodeHub();
      const { output } = makeSpeechOutput();
      const confirmationAudio = Buffer.from("confirmation-wav");

      const service = makeVoiceAutomationService({
        voiceNodeHub: hub,
        systemName: "housekeeper",
        classifier: makeClassifier({ type: "unknown" }),
        devices: makeDeviceRepo([]),
        automations: makeAutomationRepo(),
        speechOutput: output,
        responseAudioCache: makeResponseAudioCache(confirmationAudio),
      });

      service.start();

      // Emit a stop-word ("wait") in ambient listening mode
      // System should recognize it and play confirmation audio
      emit("wait", TEST_NODE_ID);

      // Wait for async processing
      await new Promise((r) => setTimeout(r, 100));

      // Verify confirmation audio was played
      const sendTtsCalls = (hub.sendTts as any).mock.calls;
      expect(sendTtsCalls.some((call: any[]) => call[1]?.equals(confirmationAudio))).toBe(true);
    });

    it("recognizes yes/no via keyword match without classification", async () => {
      const { hub, emit } = makeVoiceNodeHub();
      const { output } = makeSpeechOutput();
      const confirmationAudio = Buffer.from("confirmation-wav");

      let classifyUtterances: string[] = [];
      const classifier: IntentClassifier = {
        classify: async (opts) => {
          classifyUtterances.push(opts.utterance);
          return { type: "unknown" };
        },
      };

      const service = makeVoiceAutomationService({
        voiceNodeHub: hub,
        systemName: "housekeeper",
        classifier,
        devices: makeDeviceRepo([]),
        automations: makeAutomationRepo(),
        speechOutput: output,
        responseAudioCache: makeResponseAudioCache(confirmationAudio),
      });

      service.start();

      // Emit stop-word to trigger confirmation and awaiting state
      emit("wait", TEST_NODE_ID);
      await new Promise((r) => setTimeout(r, 50));

      // Verify confirmation was played
      expect((hub.sendTts as any).mock.calls.some((c: any[]) => c[1]?.equals(confirmationAudio))).toBe(true);

      // Emit "yes" - should trigger yes-path (not classification)
      emit("yes", TEST_NODE_ID);
      await new Promise((r) => setTimeout(r, 50));

      // "yes" should NOT have been classified
      expect(classifyUtterances).not.toContain("yes");

      // Emit "no" after another stop-word
      emit("stop", TEST_NODE_ID);
      await new Promise((r) => setTimeout(r, 50));

      emit("nope", TEST_NODE_ID);
      await new Promise((r) => setTimeout(r, 50));

      expect(classifyUtterances).not.toContain("nope");
    });

    it("handles timeout when no yes/no response within 3 seconds", async () => {
      const { hub, emit } = makeVoiceNodeHub();
      const { output } = makeSpeechOutput();
      const confirmationAudio = Buffer.from("confirmation-wav");

      const service = makeVoiceAutomationService({
        voiceNodeHub: hub,
        systemName: "housekeeper",
        classifier: makeClassifier({ type: "unknown" }),
        devices: makeDeviceRepo([]),
        automations: makeAutomationRepo(),
        speechOutput: output,
        responseAudioCache: makeResponseAudioCache(confirmationAudio),
      });

      service.start();

      // Emit stop-word to trigger confirmation and 3-second window
      emit("wait", TEST_NODE_ID);
      await new Promise((r) => setTimeout(r, 50));

      // Verify confirmation was played
      expect((hub.sendTts as any).mock.calls.some((c: any[]) => c[1]?.equals(confirmationAudio))).toBe(true);

      // Wait for timeout (3 seconds + buffer)
      await new Promise((r) => setTimeout(r, 3100));

      // Interruption should have completed (timeout path taken)
      // This is just verifying it doesn't crash - actual replay behavior tested elsewhere
      expect(service).toBeDefined();
    });

    it("suppresses yes/no classification when awaiting response", async () => {
      const { hub, emit } = makeVoiceNodeHub();
      const { output } = makeSpeechOutput();
      const confirmationAudio = Buffer.from("confirmation-wav");

      let classifyUtterances: string[] = [];
      const classifier: IntentClassifier = {
        classify: async (opts) => {
          classifyUtterances.push(opts.utterance);
          return { type: "unknown" };
        },
      };

      const service = makeVoiceAutomationService({
        voiceNodeHub: hub,
        systemName: "housekeeper",
        classifier,
        devices: makeDeviceRepo([]),
        automations: makeAutomationRepo(),
        speechOutput: output,
        responseAudioCache: makeResponseAudioCache(confirmationAudio),
      });

      service.start();

      // Emit stop-word to enter awaiting response state
      emit("stop", TEST_NODE_ID);
      await new Promise((r) => setTimeout(r, 50));

      // Get baseline classification count
      const baselineCount = classifyUtterances.length;

      // Emit "yes" while awaiting - should NOT be classified
      emit("yes", TEST_NODE_ID);
      await new Promise((r) => setTimeout(r, 50));

      // Classification count should not have increased
      expect(classifyUtterances.length).toBe(baselineCount);
      expect(classifyUtterances).not.toContain("yes");
    });

    it("dispatches unknown intent on yes response", async () => {
      const { hub, emit } = makeVoiceNodeHub();
      const { output } = makeSpeechOutput();
      const confirmationAudio = Buffer.from("confirmation-wav");
      const { gateway, published } = makeGateway();

      let dispatchedIntents: Array<{ type: string }> = [];
      const classifier: IntentClassifier = {
        classify: async (opts) => {
          // Capture device-control intent that would normally happen
          if (opts.utterance === "turn on lights") {
            dispatchedIntents.push({ type: "device-control" });
            return {
              type: "device-control",
              deviceLabel: "Lights",
              command: "on",
              response: "Lights are on",
            };
          }
          dispatchedIntents.push({ type: "unknown" });
          return { type: "unknown" };
        },
      };

      const service = makeVoiceAutomationService({
        voiceNodeHub: hub,
        systemName: "housekeeper",
        classifier,
        devices: makeDeviceRepo([]),
        automations: makeAutomationRepo(),
        speechOutput: output,
        gateway,
        responseAudioCache: makeResponseAudioCache(confirmationAudio),
      });

      service.start();

      // Emit stop-word to trigger interruption
      emit("wait", TEST_NODE_ID);
      await new Promise((r) => setTimeout(r, 50));

      // Clear intent tracking to isolate yes response
      dispatchedIntents = [];

      // Emit "yes" response - should dispatch unknown intent
      emit("yes", TEST_NODE_ID);
      await new Promise((r) => setTimeout(r, 50));

      // Unknown intent should have been dispatched (implicitly - it was handled without classification)
      // We verify this by checking that no device action was taken
      // (A device-control would have published to gateway)
      expect(published.length).toBe(0);
    });

    it("logs interruption flow for debugging", async () => {
      const { hub, emit } = makeVoiceNodeHub();
      const { output } = makeSpeechOutput();
      const confirmationAudio = Buffer.from("confirmation-wav");

      const consoleSpy = vi.spyOn(console, "log");

      const service = makeVoiceAutomationService({
        voiceNodeHub: hub,
        systemName: "housekeeper",
        classifier: makeClassifier({ type: "unknown" }),
        devices: makeDeviceRepo([]),
        automations: makeAutomationRepo(),
        speechOutput: output,
        responseAudioCache: makeResponseAudioCache(confirmationAudio),
      });

      service.start();

      // Test stop-word + yes flow
      emit("wait", TEST_NODE_ID);
      await new Promise((r) => setTimeout(r, 50));

      emit("yes", TEST_NODE_ID);
      await new Promise((r) => setTimeout(r, 50));

      // Verify logging messages were output
      const logMessages = consoleSpy.mock.calls
        .map((call) => call[0])
        .filter((msg) => typeof msg === "string" && msg.includes("[VoiceAutomation] Interruption"));

      expect(logMessages.length).toBeGreaterThan(0);
      expect(logMessages.some((msg) => msg.includes("stop-word → confirmation played"))).toBe(true);
      expect(logMessages.some((msg) => msg.includes("→ yes →"))).toBe(true);

      consoleSpy.mockRestore();
    });
  });
});
