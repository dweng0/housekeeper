import { describe, it, expect, afterEach } from "vitest";
import { WebSocket, WebSocketServer } from "ws";
import { makeWebSocketVoiceNodeHub } from "./websocket-voice-node-hub.js";
import { PiperTtsAdapter } from "./piper-tts-adapter.js";
import type { AppConfig, ConfigRepository, VoiceNode, VoiceNodeRepository } from "../ports.js";

function makeInMemoryRepo(): VoiceNodeRepository {
  const nodes: VoiceNode[] = [];
  return {
    findAll: async () => [...nodes],
    findById: async (id) => nodes.find((n) => n.id === id) ?? null,
    save: async (node) => {
      const idx = nodes.findIndex((n) => n.id === node.id);
      if (idx >= 0) nodes[idx] = node; else nodes.push(node);
    },
    delete: async (id) => { nodes.splice(0, nodes.length, ...nodes.filter((n) => n.id !== id)); },
  };
}

function makeConfigRepo(config: Partial<AppConfig> = {}): ConfigRepository {
  const full: AppConfig = { autoDiscovery: false, ...config };
  return { get: async () => full, save: async () => {} };
}

function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = new WebSocketServer({ port: 0 });
    srv.on("listening", () => {
      const addr = srv.address() as { port: number };
      srv.close(() => resolve(addr.port));
    });
    srv.on("error", reject);
  });
}

function connect(port: number): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:${port}`);
    ws.on("open", () => resolve(ws));
    ws.on("error", reject);
  });
}

function register(ws: WebSocket, id: string, capabilities: ("mic" | "speaker")[]): Promise<void> {
  return new Promise((resolve) => {
    ws.send(JSON.stringify({ type: "register", id, label: id, location: "test room", capabilities }));
    const onMessage = (data: Buffer, isBinary: boolean) => {
      if (isBinary) return;
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === "registered") { ws.off("message", onMessage); resolve(); }
      } catch { /* ignore */ }
    };
    ws.on("message", onMessage);
  });
}

function nextBinaryFrame(ws: WebSocket): Promise<Buffer> {
  return new Promise((resolve) => {
    const onMessage = (data: Buffer, isBinary: boolean) => {
      if (isBinary) { ws.off("message", onMessage); resolve(data); }
    };
    ws.on("message", onMessage);
  });
}

// Subclass that bypasses piper binary for testing
class FakeTtsAdapter extends PiperTtsAdapter {
  private fakeAudio: Buffer;

  constructor(fakeAudio: Buffer, opts: ConstructorParameters<typeof PiperTtsAdapter>[0]) {
    super(opts);
    this.fakeAudio = fakeAudio;
  }

  async speak(text: string, originatingNodeId: string): Promise<void> {
    // Call parent speak but with overridden render
    const audio = this.fakeAudio;
    const target = await (this as any).resolveTarget(originatingNodeId);
    if (!target) return;
    await (this as any).hub.sendTts(target, audio);
  }
}

const FAKE_PCM = Buffer.from([0xde, 0xad, 0xbe, 0xef]);

describe("TTS routing integration", () => {
  const hubs: ReturnType<typeof makeWebSocketVoiceNodeHub>[] = [];

  afterEach(() => hubs.forEach((h) => h.stop()));

  it("routes audio to originating node when it has speaker capability", async () => {
    const port = await getFreePort();
    const hub = makeWebSocketVoiceNodeHub(makeInMemoryRepo(), port);
    hubs.push(hub);
    hub.start();

    const ws = await connect(port);
    await register(ws, "node-lounge", ["mic", "speaker"]);

    const tts = new FakeTtsAdapter(FAKE_PCM, {
      voicePath: "fake.onnx",
      voiceNodeHub: hub,
      config: makeConfigRepo(),
    });

    const framePromise = nextBinaryFrame(ws);
    await tts.speak("The lounge light is now on.", "node-lounge");
    const frame = await framePromise;

    expect(frame).toEqual(FAKE_PCM);
    ws.close();
  });

  it("routes audio to default output node when originating node has no speaker", async () => {
    const port = await getFreePort();
    const hub = makeWebSocketVoiceNodeHub(makeInMemoryRepo(), port);
    hubs.push(hub);
    hub.start();

    const micOnly = await connect(port);
    const speaker = await connect(port);
    await register(micOnly, "node-mic", ["mic"]);
    await register(speaker, "node-speaker", ["mic", "speaker"]);

    const tts = new FakeTtsAdapter(FAKE_PCM, {
      voicePath: "fake.onnx",
      voiceNodeHub: hub,
      config: makeConfigRepo({ defaultOutputNodeId: "node-speaker" }),
    });

    const speakerFrame = nextBinaryFrame(speaker);
    await tts.speak("Done.", "node-mic");
    const frame = await speakerFrame;

    expect(frame).toEqual(FAKE_PCM);
    micOnly.close();
    speaker.close();
  });

  it("drops audio when originating node has no speaker and no default configured", async () => {
    const port = await getFreePort();
    const hub = makeWebSocketVoiceNodeHub(makeInMemoryRepo(), port);
    hubs.push(hub);
    hub.start();

    const ws = await connect(port);
    await register(ws, "node-mic-only", ["mic"]);

    const tts = new FakeTtsAdapter(FAKE_PCM, {
      voicePath: "fake.onnx",
      voiceNodeHub: hub,
      config: makeConfigRepo(), // no defaultOutputNodeId
    });

    // Should complete without throwing and send nothing
    await tts.speak("Hello.", "node-mic-only");

    // No binary frame arrives within 100ms
    const received = await Promise.race([
      nextBinaryFrame(ws).then(() => true),
      new Promise<false>((r) => setTimeout(() => r(false), 100)),
    ]);
    expect(received).toBe(false);
    ws.close();
  });
});
