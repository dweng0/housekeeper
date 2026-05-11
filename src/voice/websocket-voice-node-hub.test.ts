import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { WebSocket, WebSocketServer } from "ws";
import { makeWebSocketVoiceNodeHub } from "./websocket-voice-node-hub.js";
import type { VoiceNode, VoiceNodeHub, VoiceNodeRepository } from "../ports.js";

const node1: VoiceNode = { id: "node-hall", label: "Hallway", location: "downstairs hallway", capabilities: ["mic"], confirmed: false, transport: "websocket" };

function makeInMemoryRepository(): VoiceNodeRepository & { nodes: VoiceNode[] } {
  const nodes: VoiceNode[] = [];
  return {
    nodes,
    async findAll() { return [...nodes]; },
    async findById(id) { return nodes.find((n) => n.id === id) ?? null; },
    async save(node) {
      const idx = nodes.findIndex((n) => n.id === node.id);
      if (idx >= 0) nodes[idx] = node; else nodes.push(node);
    },
    async delete(id) { nodes.splice(0, nodes.length, ...nodes.filter((n) => n.id !== id)); },
  };
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

function nextMessage(ws: WebSocket): Promise<unknown> {
  return new Promise((resolve) => {
    ws.once("message", (data) => resolve(JSON.parse(data.toString())));
  });
}

function registerMessage(overrides: Partial<{ id: string; label: string; location: string; capabilities: string[] }> = {}) {
  return JSON.stringify({
    type: "register",
    id: "node-hall",
    label: "Hallway",
    location: "downstairs hallway",
    capabilities: ["mic"],
    ...overrides,
  });
}

let port: number;
let repo: ReturnType<typeof makeInMemoryRepository>;
let hub: VoiceNodeHub;
let client: WebSocket;

beforeEach(async () => {
  port = await getFreePort();
  repo = makeInMemoryRepository();
  hub = makeWebSocketVoiceNodeHub(repo, port);
  hub.start();
});

afterEach(async () => {
  client?.terminate();
  hub.stop();
  await new Promise((r) => setTimeout(r, 20));
});

describe("WebSocketVoiceNodeHub — registration", () => {
  it("new node gets registered response with status new", async () => {
    client = await connect(port);
    const reply = nextMessage(client);
    client.send(registerMessage());
    expect(await reply).toMatchObject({ type: "registered", id: "node-hall", status: "new" });
  });

  it("known node gets registered response with status reconnected", async () => {
    await repo.save(node1);
    client = await connect(port);
    const reply = nextMessage(client);
    client.send(registerMessage());
    expect(await reply).toMatchObject({ type: "registered", status: "reconnected" });
  });

  it("persists new node to repository", async () => {
    client = await connect(port);
    const reply = nextMessage(client);
    client.send(registerMessage());
    await reply;
    expect(await repo.findById("node-hall")).not.toBeNull();
  });

  it("register with missing field sends INVALID_MESSAGE error", async () => {
    client = await connect(port);
    const reply = nextMessage(client);
    client.send(JSON.stringify({ type: "register", id: "x" }));
    expect(await reply).toMatchObject({ type: "error", code: "INVALID_MESSAGE" });
  });
});

describe("WebSocketVoiceNodeHub — utterances", () => {
  it("utterance before register sends REGISTRATION_REQUIRED error", async () => {
    client = await connect(port);
    const reply = nextMessage(client);
    client.send(JSON.stringify({ type: "utterance", text: "hello" }));
    expect(await reply).toMatchObject({ type: "error", code: "REGISTRATION_REQUIRED" });
  });

  it("utterance after register fires onUtterance handler with nodeId and text", async () => {
    const received: { nodeId: string; text: string }[] = [];
    hub.onUtterance((nodeId, text) => received.push({ nodeId, text }));

    client = await connect(port);
    const regReply = nextMessage(client);
    client.send(registerMessage());
    await regReply;

    client.send(JSON.stringify({ type: "utterance", text: "turn on the lights" }));
    await vi.waitFor(() => expect(received).toHaveLength(1));
    expect(received[0]).toEqual({ nodeId: "node-hall", text: "turn on the lights" });
  });

  it("utterance with empty text sends INVALID_MESSAGE error", async () => {
    client = await connect(port);
    const regReply = nextMessage(client);
    client.send(registerMessage());
    await regReply;

    const errReply = nextMessage(client);
    client.send(JSON.stringify({ type: "utterance", text: "" }));
    expect(await errReply).toMatchObject({ type: "error", code: "INVALID_MESSAGE" });
  });
});

describe("WebSocketVoiceNodeHub — node state", () => {
  it("getNode returns registered node", async () => {
    client = await connect(port);
    const reply = nextMessage(client);
    client.send(registerMessage());
    await reply;
    expect(hub.getNode("node-hall")).toMatchObject({ id: "node-hall", label: "Hallway" });
  });

  it("getConnectedNodes returns all registered nodes", async () => {
    client = await connect(port);
    const reply = nextMessage(client);
    client.send(registerMessage());
    await reply;
    expect(hub.getConnectedNodes()).toHaveLength(1);
    expect(hub.getConnectedNodes()[0].id).toBe("node-hall");
  });

  it("disconnected node removed from getConnectedNodes", async () => {
    client = await connect(port);
    const reply = nextMessage(client);
    client.send(registerMessage());
    await reply;

    await new Promise<void>((resolve) => {
      client.on("close", resolve);
      client.close();
    });
    await new Promise((r) => setTimeout(r, 20));

    expect(hub.getConnectedNodes()).toHaveLength(0);
  });
});

describe("WebSocketVoiceNodeHub — TTS", () => {
  it("sendTts sends tts_stream_start, buffer, tts_stream_end frames (streaming protocol)", async () => {
    client = await connect(port);
    const regReply = nextMessage(client);
    client.send(registerMessage());
    await regReply;

    const received: unknown[] = [];
    client.on("message", (data, isBinary) => {
      if (isBinary) {
        received.push({ type: "binary", data: data as Buffer });
      } else {
        received.push(JSON.parse(data.toString()));
      }
    });

    const audio = Buffer.from("fake-audio");
    await hub.sendTts("node-hall", audio);
    await vi.waitFor(() => expect(received).toHaveLength(3));
    expect(received[0]).toMatchObject({ type: "tts_stream_start" });
    expect(received[1]).toMatchObject({ type: "binary", data: audio });
    expect(received[2]).toMatchObject({ type: "tts_stream_end" });
  });

  it("sendTts to unknown node is silent no-op", async () => {
    await expect(hub.sendTts("ghost", Buffer.from("x"))).resolves.toBeUndefined();
  });
});

describe("WebSocketVoiceNodeHub — sendTtsStream", () => {
  it("sendTtsStream sends tts_stream_start, chunks, tts_stream_end frames", async () => {
    client = await connect(port);
    const regReply = nextMessage(client);
    client.send(registerMessage());
    await regReply;

    const received: unknown[] = [];
    client.on("message", (data, isBinary) => {
      if (isBinary) {
        received.push({ type: "binary", data: data as Buffer });
      } else {
        received.push(JSON.parse(data.toString()));
      }
    });

    async function* chunks() {
      yield Buffer.from("chunk-1");
      yield Buffer.from("chunk-2");
    }

    await hub.sendTtsStream("node-hall", chunks());

    await vi.waitFor(() => expect(received).toHaveLength(4), { timeout: 1000 });
    expect(received[0]).toMatchObject({ type: "tts_stream_start" });
    expect(received[1]).toMatchObject({ type: "binary", data: Buffer.from("chunk-1") });
    expect(received[2]).toMatchObject({ type: "binary", data: Buffer.from("chunk-2") });
    expect(received[3]).toMatchObject({ type: "tts_stream_end" });
  });

  it("sendTtsStream to unknown node is silent no-op and returns streamToken", async () => {
    async function* chunks() {
      yield Buffer.from("x");
    }
    const token = await hub.sendTtsStream("ghost", chunks());
    expect(token).toBeDefined();
    expect(typeof token).toBe("string");
  });
});

describe("WebSocketVoiceNodeHub — sendConfig", () => {
  it("sends config_update JSON frame to connected node", async () => {
    client = await connect(port);
    const regReply = nextMessage(client);
    client.send(registerMessage());
    await regReply;

    const received: unknown[] = [];
    client.on("message", (data, isBinary) => { if (!isBinary) received.push(JSON.parse(data.toString())); });

    await hub.sendConfig("node-hall", { label: "Kitchen", location: "kitchen counter" });
    await vi.waitFor(() => expect(received).toHaveLength(1));
    expect(received[0]).toEqual({ type: "config_update", label: "Kitchen", location: "kitchen counter" });
  });

  it("sendConfig to offline node is silent no-op", async () => {
    await expect(hub.sendConfig("ghost", { label: "Kitchen" })).resolves.toBeUndefined();
  });

  it("sendConfig omits undefined fields from JSON frame", async () => {
    client = await connect(port);
    const regReply = nextMessage(client);
    client.send(registerMessage());
    await regReply;

    const received: unknown[] = [];
    client.on("message", (data, isBinary) => { if (!isBinary) received.push(JSON.parse(data.toString())); });

    await hub.sendConfig("node-hall", { label: "Kitchen" });
    await vi.waitFor(() => expect(received).toHaveLength(1));
    expect(received[0]).not.toHaveProperty("location");
    expect(received[0]).not.toHaveProperty("devices");
  });

  it("config_updated ACK from node does not crash hub", async () => {
    client = await connect(port);
    const regReply = nextMessage(client);
    client.send(registerMessage());
    await regReply;

    client.send(JSON.stringify({ type: "config_updated", success: true }));
    await new Promise((r) => setTimeout(r, 20));
    expect(hub.getConnectedNodes()).toHaveLength(1);
  });
});

describe("WebSocketVoiceNodeHub — stream chunk caching", () => {
  it("buffers TTS stream chunks and retrieves by streamToken (tracer bullet)", async () => {
    client = await connect(port);
    const regReply = nextMessage(client);
    client.send(registerMessage());
    await regReply;

    async function* chunks() {
      yield Buffer.from("chunk-1");
      yield Buffer.from("chunk-2");
      yield Buffer.from("chunk-3");
    }

    const streamToken = await hub.sendTtsStream("node-hall", chunks());

    expect(streamToken).toBeDefined();
    expect(typeof streamToken).toBe("string");

    const retrieved = hub.getStreamBuffer("node-hall", streamToken);
    expect(retrieved).toBeDefined();
    expect(retrieved).toHaveLength(3);
    expect(retrieved?.[0]).toEqual(Buffer.from("chunk-1"));
    expect(retrieved?.[1]).toEqual(Buffer.from("chunk-2"));
    expect(retrieved?.[2]).toEqual(Buffer.from("chunk-3"));
  });

  it("returns null for expired stream cache entries", async () => {
    client = await connect(port);
    const regReply = nextMessage(client);
    client.send(registerMessage());
    await regReply;

    async function* chunks() {
      yield Buffer.from("chunk-1");
    }

    const streamToken = await hub.sendTtsStream("node-hall", chunks());

    // Verify it exists first
    const initial = hub.getStreamBuffer("node-hall", streamToken);
    expect(initial).not.toBeNull();

    // Fast-forward time to simulate expiry (TTL: 30s)
    await vi.waitFor(() => {
      const expired = hub.getStreamBuffer("node-hall", streamToken);
      return expired === null;
    }, { timeout: 31000 });
  });

  it("retrieves unknown or invalid token returns null", async () => {
    client = await connect(port);
    const regReply = nextMessage(client);
    client.send(registerMessage());
    await regReply;

    const result = hub.getStreamBuffer("node-hall", "invalid-token");
    expect(result).toBeNull();
  });

  it("concurrent streams each get unique tokens and separate buffers", async () => {
    client = await connect(port);
    const regReply = nextMessage(client);
    client.send(registerMessage());
    await regReply;

    async function* chunks1() {
      yield Buffer.from("stream1-chunk1");
      yield Buffer.from("stream1-chunk2");
    }

    async function* chunks2() {
      yield Buffer.from("stream2-chunk1");
      yield Buffer.from("stream2-chunk2");
    }

    const token1 = await hub.sendTtsStream("node-hall", chunks1());
    const token2 = await hub.sendTtsStream("node-hall", chunks2());

    expect(token1).not.toBe(token2);

    const buffer1 = hub.getStreamBuffer("node-hall", token1);
    const buffer2 = hub.getStreamBuffer("node-hall", token2);

    expect(buffer1).toHaveLength(2);
    expect(buffer2).toHaveLength(2);
    expect(buffer1?.[0]).toEqual(Buffer.from("stream1-chunk1"));
    expect(buffer2?.[0]).toEqual(Buffer.from("stream2-chunk1"));
  });
});

describe("WebSocketVoiceNodeHub — invalid messages", () => {
  it("invalid JSON sends INVALID_MESSAGE error", async () => {
    client = await connect(port);
    const reply = nextMessage(client);
    client.send("not json {{{");
    expect(await reply).toMatchObject({ type: "error", code: "INVALID_MESSAGE" });
  });

  it("unknown message type sends INVALID_MESSAGE error", async () => {
    client = await connect(port);
    const reply = nextMessage(client);
    client.send(JSON.stringify({ type: "ping" }));
    expect(await reply).toMatchObject({ type: "error", code: "INVALID_MESSAGE" });
  });
});
