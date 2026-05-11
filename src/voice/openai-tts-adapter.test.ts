import { describe, it, expect, vi, beforeEach } from "vitest";
import { OpenAiTtsAdapter } from "./openai-tts-adapter.js";
import type { VoiceNodeHub, ConfigRepository } from "../ports.js";

const ENDPOINT = "http://tts.local";
const MODEL = "kokoro";
const VOICE = "af";
const API_KEY = "test-key";

function makeMockHub(): VoiceNodeHub {
  return {
    start: vi.fn(),
    stop: vi.fn(),
    onUtterance: vi.fn(),
    sendTts: vi.fn(),
    sendTtsStream: vi.fn(),
    sendConfig: vi.fn(),
    getNode: vi.fn(),
    getConnectedNodes: vi.fn(),
    pushUtterance: vi.fn(),
  };
}

function makeMockConfigRepo(): ConfigRepository {
  return {
    get: vi.fn().mockResolvedValue({ defaultOutputNodeId: "speaker-node" }),
    save: vi.fn(),
  };
}

describe("OpenAiTtsAdapter — streaming speak", () => {
  let mockHub: ReturnType<typeof makeMockHub>;
  let mockConfig: ReturnType<typeof makeMockConfigRepo>;
  let mockFetch: ReturnType<typeof vi.fn>;
  let adapter: OpenAiTtsAdapter;

  beforeEach(() => {
    mockHub = makeMockHub();
    mockConfig = makeMockConfigRepo();
    mockFetch = vi.fn();

    mockHub.getNode = vi.fn().mockImplementation((nodeId) => {
      if (nodeId === "originating-node" || nodeId === "speaker-node") {
        return {
          id: nodeId,
          label: "Speaker",
          location: "room",
          capabilities: ["speaker"],
          confirmed: true,
          transport: "websocket",
        };
      }
      return undefined;
    });
    (mockHub.sendTtsStream as any).mockImplementation(async (nodeId: string, chunks: AsyncIterable<Buffer>) => {
      // Consume the chunks to trigger the fetch
      for await (const chunk of chunks) {
        // Just consume
      }
    });

    adapter = new OpenAiTtsAdapter({
      endpoint: ENDPOINT,
      model: MODEL,
      voice: VOICE,
      apiKey: API_KEY,
      voiceNodeHub: mockHub,
      config: mockConfig,
      fetch: mockFetch,
    });
  });

  it("speak() calls Kokoro with stream: true and passes chunks to sendTtsStream", async () => {
    const chunks = [Buffer.from("chunk-1"), Buffer.from("chunk-2")];

    const mockBodyIterator = (async function* () {
      for (const chunk of chunks) {
        yield chunk;
      }
    })();

    const mockResponse = {
      ok: true,
      body: mockBodyIterator,
    };

    mockFetch.mockResolvedValue(mockResponse);

    try {
      await adapter.speak("Test text", "originating-node");
    } catch (e) {
      console.error("Error in speak:", e);
      throw e;
    }

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${ENDPOINT}/v1/audio/speech`);

    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({
      model: MODEL,
      voice: VOICE,
      input: "Test text",
      response_format: "pcm",
      stream: true,
    });

    expect(mockHub.sendTtsStream).toHaveBeenCalledOnce();
    const [nodeId] = (mockHub.sendTtsStream as any).mock.calls[0];
    expect(nodeId).toBe("originating-node");
  });

  it("short single-chunk response works correctly", async () => {
    const singleChunk = Buffer.from("short-audio");

    const mockBodyIterator = (async function* () {
      yield singleChunk;
    })();

    mockFetch.mockResolvedValue({
      ok: true,
      body: mockBodyIterator,
    });

    await adapter.speak("Hello", "originating-node");

    expect(mockFetch).toHaveBeenCalledOnce();
    expect(mockHub.sendTtsStream).toHaveBeenCalledOnce();
  });

  it("error from Kokoro is thrown cleanly", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => "Internal Server Error",
    });

    await expect(adapter.speak("Test", "originating-node")).rejects.toThrow("TTS HTTP 500");
  });

  it("no speaker node available logs warning", async () => {
    mockHub.getNode = vi.fn().mockReturnValue(undefined);
    const consoleWarn = vi.spyOn(console, "warn");

    await adapter.speak("Test", "unknown-node");

    expect(consoleWarn).toHaveBeenCalledWith("[TTS] No speaker node available, dropping response");
    expect(mockFetch).not.toHaveBeenCalled();
    expect(mockHub.sendTtsStream).not.toHaveBeenCalled();
  });
});
