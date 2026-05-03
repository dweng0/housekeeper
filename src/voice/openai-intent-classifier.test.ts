import { describe, it, expect, vi, afterEach } from "vitest";
import type { ClassifiedIntent, Device, DeviceRepository } from "../ports.js";
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
    const result = await classifier.classify("Jarvis when the front door opens turn on the porch light");
    expect(result.type).toBe("create-automation");
    expect(result.automation?.trigger.deviceLabel).toBe("Front Door");
  });

  it("returns unknown intent when LLM says not a directed question", async () => {
    mockFetch({ choices: [{ message: { content: JSON.stringify({ type: "unknown" }) } }] });

    const classifier = makeOpenAIIntentClassifier({ endpoint, model, devices: makeDeviceRepo([]) });
    const result = await classifier.classify("I wonder what the weather is like");
    expect(result.type).toBe("unknown");
  });

  it("returns unknown intent when LLM response is unparseable", async () => {
    mockFetch({ choices: [{ message: { content: "not json at all" } }] });

    const classifier = makeOpenAIIntentClassifier({ endpoint, model, devices: makeDeviceRepo([]) });
    const result = await classifier.classify("Jarvis do something");
    expect(result.type).toBe("unknown");
  });

  it("returns unknown intent when fetch fails", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network error"));

    const classifier = makeOpenAIIntentClassifier({ endpoint, model, devices: makeDeviceRepo([]) });
    const result = await classifier.classify("Jarvis do something");
    expect(result.type).toBe("unknown");
  });

  it("includes device labels in system prompt sent to LLM", async () => {
    const fetchSpy = mockFetch({ choices: [{ message: { content: JSON.stringify({ type: "unknown" }) } }] });

    const classifier = makeOpenAIIntentClassifier({ endpoint, model, devices: makeDeviceRepo(["Kitchen Light", "Back Door"]) });
    await classifier.classify("something");

    const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
    const systemPrompt = body.messages[0].content as string;
    expect(systemPrompt).toContain("Kitchen Light");
    expect(systemPrompt).toContain("Back Door");
  });

  it("injects memory context into system prompt when provided", async () => {
    const fetchSpy = mockFetch({ choices: [{ message: { content: JSON.stringify({ type: "unknown" }) } }] });

    const classifier = makeOpenAIIntentClassifier({ endpoint, model, devices: makeDeviceRepo([]) });
    await classifier.classify("something", undefined, ["Jay prefers lights dim at night"]);

    const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
    const systemPrompt = body.messages[0].content as string;
    expect(systemPrompt).toContain("Jay prefers lights dim at night");
  });
});
