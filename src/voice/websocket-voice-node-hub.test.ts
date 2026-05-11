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
  it("sendTts delivers binary frame to registered node", async () => {
    client = await connect(port);
    const regReply = nextMessage(client);
    client.send(registerMessage());
    await regReply;

    const received: Buffer[] = [];
    client.on("message", (data, isBinary) => { if (isBinary) received.push(data as Buffer); });

    const audio = Buffer.from("fake-audio");
    await hub.sendTts("node-hall", audio);
    await vi.waitFor(() => expect(received).toHaveLength(1));
    expect(received[0]).toEqual(audio);
  });

  it("sendTts to unknown node is silent no-op", async () => {
    await expect(hub.sendTts("ghost", Buffer.from("x"))).resolves.toBeUndefined();
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
