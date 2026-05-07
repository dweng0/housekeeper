import { describe, it, expect, vi, afterEach } from "vitest";
import type { ClassifiedIntent, Device, DeviceRepository, ConfigRepository } from "../ports.js";
import { makeOpenAIIntentClassifier } from "./openai-intent-classifier.js";

const endpoint = "http://localhost:11434/v1";
const model = "llama3";

function makeDeviceRepo(labels: string[]): DeviceRepository {
  const devices: Device[] = labels.map((label, i) => ({
    id: String(i),
    label,
    topic: `home/${label.toLowerCase().replace(/\s/g, "-")}`,
    type: "sensor" as const,
  }));
  return {
    findAll: async () => devices,
    findByLabel: async (label) => devices.find((d) => d.label === label) ?? null,
    save: async () => {},
    delete: async () => {},
  };
}

function mockFetch(response: unknown, ok = true) {
  return vi.spyOn(globalThis, "fetch").mockResolvedValue({
    ok,
    json: async () => response,
    text: async () => JSON.stringify(response),
  } as Response);
}

afterEach(() => vi.restoreAllMocks());

describe("OpenAIIntentClassifier", () => {
  it("returns create-automation intent for a valid LLM response", async () => {
    const intent: ClassifiedIntent = {
      type: "create-automation",
      automation: {
        enabled: true,
        trigger: { deviceLabel: "Front Door", event: "open" },
        actions: [{ deviceLabel: "Porch Light", command: "on" }],
      },
    };
    mockFetch({ choices: [{ message: { content: JSON.stringify(intent) } }] });

    const classifier = makeOpenAIIntentClassifier({ endpoint, model, devices: makeDeviceRepo(["Front Door", "Porch Light"]) });
    const result = await classifier.classify({ utterance: "Jarvis when the front door opens turn on the porch light" });
    expect(result.type).toBe("create-automation");
    expect(result.automation?.trigger.deviceLabel).toBe("Front Door");
  });

  it("returns unknown intent when LLM says not a directed question", async () => {
    mockFetch({ choices: [{ message: { content: JSON.stringify({ type: "unknown" }) } }] });

    const classifier = makeOpenAIIntentClassifier({ endpoint, model, devices: makeDeviceRepo([]) });
    const result = await classifier.classify({ utterance: "I wonder what the weather is like" });
    expect(result.type).toBe("unknown");
  });

  it("returns unknown intent when LLM response is unparseable", async () => {
    mockFetch({ choices: [{ message: { content: "not json at all" } }] });

    const classifier = makeOpenAIIntentClassifier({ endpoint, model, devices: makeDeviceRepo([]) });
    const result = await classifier.classify({ utterance: "Jarvis do something" });
    expect(result.type).toBe("unknown");
  });

  it("returns unknown intent when fetch fails", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network error"));

    const classifier = makeOpenAIIntentClassifier({ endpoint, model, devices: makeDeviceRepo([]) });
    const result = await classifier.classify({ utterance: "Jarvis do something" });
    expect(result.type).toBe("unknown");
  });

  it("includes device labels in system prompt sent to LLM", async () => {
    const fetchSpy = mockFetch({ choices: [{ message: { content: JSON.stringify({ type: "unknown" }) } }] });

    const classifier = makeOpenAIIntentClassifier({ endpoint, model, devices: makeDeviceRepo(["Kitchen Light", "Back Door"]) });
    await classifier.classify({ utterance: "something" });

    const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
    const systemPrompt = body.messages[0].content as string;
    expect(systemPrompt).toContain("Kitchen Light");
    expect(systemPrompt).toContain("Back Door");
  });

  it("injects memory context into system prompt when provided", async () => {
    const fetchSpy = mockFetch({ choices: [{ message: { content: JSON.stringify({ type: "unknown" }) } }] });

    const classifier = makeOpenAIIntentClassifier({ endpoint, model, devices: makeDeviceRepo([]) });
    await classifier.classify({ utterance: "something", memories: ["Jay prefers lights dim at night"] });

    const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
    const systemPrompt = body.messages[0].content as string;
    expect(systemPrompt).toContain("Jay prefers lights dim at night");
  });

  it("sends Authorization header when apiKey provided", async () => {
    const fetchSpy = mockFetch({ choices: [{ message: { content: JSON.stringify({ type: "unknown" }) } }] });

    const classifier = makeOpenAIIntentClassifier({ endpoint, model, devices: makeDeviceRepo([]), apiKey: "sk-test-123" });
    await classifier.classify({ utterance: "something" });

    const headers = (fetchSpy.mock.calls[0][1] as RequestInit).headers as Record<string, string>;
    expect(headers["Authorization"]).toBe("Bearer sk-test-123");
  });

  it("omits Authorization header when apiKey not provided", async () => {
    const fetchSpy = mockFetch({ choices: [{ message: { content: JSON.stringify({ type: "unknown" }) } }] });

    const classifier = makeOpenAIIntentClassifier({ endpoint, model, devices: makeDeviceRepo([]) });
    await classifier.classify({ utterance: "something" });

    const headers = (fetchSpy.mock.calls[0][1] as RequestInit).headers as Record<string, string>;
    expect(headers["Authorization"]).toBeUndefined();
  });

  it("prepends persona to system prompt", async () => {
    const fetchSpy = mockFetch({ choices: [{ message: { content: JSON.stringify({ type: "unknown" }) } }] });

    const classifier = makeOpenAIIntentClassifier({
      endpoint,
      model,
      devices: makeDeviceRepo([]),
      persona: "You are a helpful assistant.",
    });
    await classifier.classify({ utterance: "something" });

    const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
    const systemPrompt = body.messages[0].content as string;
    expect(systemPrompt.indexOf("You are a helpful assistant.")).toBe(0);
  });

  it("replaces {SYSTEM_NAME} placeholder in persona", async () => {
    const fetchSpy = mockFetch({ choices: [{ message: { content: JSON.stringify({ type: "unknown" }) } }] });

    const classifier = makeOpenAIIntentClassifier({
      endpoint,
      model,
      devices: makeDeviceRepo([]),
      persona: "You are {SYSTEM_NAME}, a smart home assistant.",
      systemName: "Housekeeper",
    });
    await classifier.classify({ utterance: "something" });

    const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
    const systemPrompt = body.messages[0].content as string;
    expect(systemPrompt).toContain("You are Housekeeper, a smart home assistant.");
    expect(systemPrompt).not.toContain("{SYSTEM_NAME}");
  });

  it("reads persona and systemName from config repository when provided", async () => {
    const fetchSpy = mockFetch({ choices: [{ message: { content: JSON.stringify({ type: "unknown" }) } }] });

    const mockConfigRepo = {
      get: async () => ({
        autoDiscovery: false,
        persona: "Custom persona from config.",
        systemName: "Jarvis",
      }),
      save: async () => {},
    };

    const classifier = makeOpenAIIntentClassifier({
      endpoint,
      model,
      devices: makeDeviceRepo([]),
      config: mockConfigRepo,
    });
    await classifier.classify({ utterance: "something" });

    const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
    const systemPrompt = body.messages[0].content as string;
    expect(systemPrompt.indexOf("Custom persona from config.")).toBe(0);
    expect(systemPrompt).not.toContain("{SYSTEM_NAME}");
  });
});
