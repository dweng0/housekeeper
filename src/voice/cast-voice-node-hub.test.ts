import { describe, it, expect, vi } from "vitest";
import type {
  CastDeviceInfo,
  CastDiscovery,
  CastClient,
  CastClientFactory,
  AudioFileServer,
  VoiceNode,
  VoiceNodeRepository,
} from "../ports.js";
import { makeCastVoiceNodeHub } from "./cast-voice-node-hub.js";

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

function makeFakeDiscovery(): CastDiscovery & {
  simulateFound(info: CastDeviceInfo): void;
  simulateLost(uuid: string): void;
} {
  let foundHandler: ((info: CastDeviceInfo) => void) | null = null;
  let lostHandler: ((uuid: string) => void) | null = null;
  return {
    start: vi.fn(),
    stop: vi.fn(),
    onDeviceFound: (h) => { foundHandler = h; },
    onDeviceLost: (h) => { lostHandler = h; },
    simulateFound: (info) => foundHandler?.(info),
    simulateLost: (uuid) => lostHandler?.(uuid),
  };
}

function makeFakeClientFactory(client: CastClient): CastClientFactory {
  return { connect: async () => client };
}

function makeFakeClient(): CastClient & { playedUrls: string[] } {
  const playedUrls: string[] = [];
  return {
    playUrl: async (url) => { playedUrls.push(url); },
    close: vi.fn(),
    playedUrls,
  };
}

function makeFakeAudioServer(returnUrl = "http://localhost:3000/tts-audio/test.wav"): AudioFileServer & { servedBuffers: Buffer[] } {
  const servedBuffers: Buffer[] = [];
  return {
    serve: async (audio) => {
      servedBuffers.push(audio);
      return { url: returnUrl, cleanup: vi.fn() };
    },
    servedBuffers,
  };
}

const DEVICE: CastDeviceInfo = { uuid: "cast-abc-123", name: "Living Room", host: "192.168.1.50", port: 8009 };

describe("CastVoiceNodeHub", () => {
  it("saves discovered Cast device as unconfirmed Cast node", async () => {
    const repo = makeInMemoryRepo();
    const discovery = makeFakeDiscovery();
    const hub = makeCastVoiceNodeHub({
      repository: repo,
      discovery,
      clientFactory: makeFakeClientFactory(makeFakeClient()),
      audioFileServer: makeFakeAudioServer(),
    });

    hub.start();
    discovery.simulateFound(DEVICE);
    await Promise.resolve();

    const saved = await repo.findById("cast-abc-123");
    expect(saved).toMatchObject({
      id: "cast-abc-123",
      label: "Living Room",
      transport: "cast",
      capabilities: ["speaker"],
      confirmed: false,
    });
  });

  it("appears in getConnectedNodes after discovery", () => {
    const discovery = makeFakeDiscovery();
    const hub = makeCastVoiceNodeHub({
      repository: makeInMemoryRepo(),
      discovery,
      clientFactory: makeFakeClientFactory(makeFakeClient()),
      audioFileServer: makeFakeAudioServer(),
    });

    hub.start();
    discovery.simulateFound(DEVICE);

    const connected = hub.getConnectedNodes();
    expect(connected).toHaveLength(1);
    expect(connected[0].id).toBe("cast-abc-123");
    expect(connected[0].transport).toBe("cast");
  });

  it("removed from getConnectedNodes when device lost", () => {
    const discovery = makeFakeDiscovery();
    const hub = makeCastVoiceNodeHub({
      repository: makeInMemoryRepo(),
      discovery,
      clientFactory: makeFakeClientFactory(makeFakeClient()),
      audioFileServer: makeFakeAudioServer(),
    });

    hub.start();
    discovery.simulateFound(DEVICE);
    discovery.simulateLost("cast-abc-123");

    expect(hub.getConnectedNodes()).toHaveLength(0);
  });

  it("sendTts serves audio and sends play URL to Cast client", async () => {
    const repo = makeInMemoryRepo();
    await repo.save({ id: "cast-abc-123", label: "Living Room", location: "", capabilities: ["speaker"], confirmed: true, transport: "cast" });
    const discovery = makeFakeDiscovery();
    const client = makeFakeClient();
    const audioServer = makeFakeAudioServer("http://localhost:3000/tts-audio/abc.wav");
    const hub = makeCastVoiceNodeHub({
      repository: repo,
      discovery,
      clientFactory: makeFakeClientFactory(client),
      audioFileServer: audioServer,
    });

    const AUDIO = Buffer.from([0x01, 0x02, 0x03]);
    hub.start();
    discovery.simulateFound(DEVICE);
    await Promise.resolve(); // flush repo.findById then-chain
    await hub.sendTts("cast-abc-123", AUDIO);

    expect(audioServer.servedBuffers[0]).toEqual(AUDIO);
    expect(client.playedUrls[0]).toBe("http://localhost:3000/tts-audio/abc.wav");
  });

  it("does not connect to Cast device until node is confirmed", async () => {
    const repo = makeInMemoryRepo();
    const discovery = makeFakeDiscovery();
    const client = makeFakeClient();
    const hub = makeCastVoiceNodeHub({
      repository: repo,
      discovery,
      clientFactory: makeFakeClientFactory(client),
      audioFileServer: makeFakeAudioServer(),
    });

    hub.start();
    discovery.simulateFound(DEVICE);
    await Promise.resolve();

    await hub.sendTts("cast-abc-123", Buffer.from([]));
    expect(client.playedUrls).toHaveLength(0);
  });

  it("connects when onNodeConfirmed is called after discovery", async () => {
    const repo = makeInMemoryRepo();
    const discovery = makeFakeDiscovery();
    const client = makeFakeClient();
    const audioServer = makeFakeAudioServer("http://localhost:3000/tts-audio/abc.wav");
    const hub = makeCastVoiceNodeHub({
      repository: repo,
      discovery,
      clientFactory: makeFakeClientFactory(client),
      audioFileServer: audioServer,
    });

    hub.start();
    discovery.simulateFound(DEVICE);
    await Promise.resolve();

    hub.onNodeConfirmed("cast-abc-123");
    await Promise.resolve(); // flush connect promise

    const AUDIO = Buffer.from([0x01, 0x02, 0x03]);
    await hub.sendTts("cast-abc-123", AUDIO);

    expect(audioServer.servedBuffers[0]).toEqual(AUDIO);
    expect(client.playedUrls[0]).toBe("http://localhost:3000/tts-audio/abc.wav");
  });

  it("sendTts to unknown node drops silently", async () => {
    const hub = makeCastVoiceNodeHub({
      repository: makeInMemoryRepo(),
      discovery: makeFakeDiscovery(),
      clientFactory: makeFakeClientFactory(makeFakeClient()),
      audioFileServer: makeFakeAudioServer(),
    });

    hub.start();
    await expect(hub.sendTts("nonexistent", Buffer.from([]))).resolves.toBeUndefined();
  });
});
