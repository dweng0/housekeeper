import { describe, it, expect } from "vitest";
import express from "express";
import request from "supertest";
import type { VoiceNode, VoiceNodeHub, VoiceNodeRepository } from "../ports.js";
import { makeVoiceNodeRouter } from "./voice-node-router.js";

const confirmed: VoiceNode = { id: "node-hall", label: "Hallway", location: "downstairs hallway", capabilities: ["mic"], confirmed: true };
const unconfirmed: VoiceNode = { id: "node-bed", label: "Bedroom", location: "upstairs bedroom", capabilities: ["mic", "speaker"], confirmed: false };

function makeRepo(initial: VoiceNode[] = []): VoiceNodeRepository & { nodes: VoiceNode[] } {
  const nodes = [...initial];
  return {
    nodes,
    findAll: async () => [...nodes],
    findById: async (id) => nodes.find((n) => n.id === id) ?? null,
    save: async (node) => {
      const idx = nodes.findIndex((n) => n.id === node.id);
      if (idx >= 0) nodes[idx] = node; else nodes.push(node);
    },
    delete: async (id) => { nodes.splice(0, nodes.length, ...nodes.filter((n) => n.id !== id)); },
  };
}

function makeHub(connected: VoiceNode[] = []): VoiceNodeHub {
  return {
    start: () => {},
    stop: () => {},
    onUtterance: () => {},
    sendTts: async () => {},
    getNode: (id) => connected.find((n) => n.id === id),
    getConnectedNodes: () => connected,
  };
}

function makeApp(repo: VoiceNodeRepository, hub: VoiceNodeHub) {
  const app = express();
  app.use(express.json());
  app.use("/api/voice-nodes", makeVoiceNodeRouter({ voiceNodes: repo, hub }));
  return app;
}

describe("GET /api/voice-nodes", () => {
  it("returns all nodes with online field", async () => {
    const repo = makeRepo([confirmed, unconfirmed]);
    const hub = makeHub([confirmed]);
    const app = makeApp(repo, hub);
    const res = await request(app).get("/api/voice-nodes");
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(res.body.find((n: VoiceNode & { online: boolean }) => n.id === "node-hall").online).toBe(true);
    expect(res.body.find((n: VoiceNode & { online: boolean }) => n.id === "node-bed").online).toBe(false);
  });

  it("returns empty array when no nodes", async () => {
    const app = makeApp(makeRepo(), makeHub());
    const res = await request(app).get("/api/voice-nodes");
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});

describe("GET /api/voice-nodes/unconfirmed", () => {
  it("returns only unconfirmed nodes with online field", async () => {
    const repo = makeRepo([confirmed, unconfirmed]);
    const hub = makeHub([unconfirmed]);
    const app = makeApp(repo, hub);
    const res = await request(app).get("/api/voice-nodes/unconfirmed");
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].id).toBe("node-bed");
    expect(res.body[0].online).toBe(true);
  });

  it("returns empty array when all nodes confirmed", async () => {
    const app = makeApp(makeRepo([confirmed]), makeHub());
    const res = await request(app).get("/api/voice-nodes/unconfirmed");
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});

describe("PUT /api/voice-nodes/:id", () => {
  it("updates label and location", async () => {
    const repo = makeRepo([confirmed]);
    const app = makeApp(repo, makeHub());
    const res = await request(app).put("/api/voice-nodes/node-hall").send({ label: "Front Hall", location: "front entrance" });
    expect(res.status).toBe(200);
    expect(res.body.label).toBe("Front Hall");
    expect(res.body.location).toBe("front entrance");
    expect((await repo.findById("node-hall"))?.label).toBe("Front Hall");
  });

  it("confirms unconfirmed node", async () => {
    const repo = makeRepo([unconfirmed]);
    const app = makeApp(repo, makeHub());
    const res = await request(app).put("/api/voice-nodes/node-bed").send({ confirmed: true });
    expect(res.status).toBe(200);
    expect(res.body.confirmed).toBe(true);
    expect((await repo.findById("node-bed"))?.confirmed).toBe(true);
  });

  it("returns 404 for unknown node", async () => {
    const app = makeApp(makeRepo(), makeHub());
    const res = await request(app).put("/api/voice-nodes/ghost").send({ label: "Ghost" });
    expect(res.status).toBe(404);
  });
});

describe("DELETE /api/voice-nodes/:id", () => {
  it("deletes node and returns 204", async () => {
    const repo = makeRepo([confirmed]);
    const app = makeApp(repo, makeHub());
    const res = await request(app).delete("/api/voice-nodes/node-hall");
    expect(res.status).toBe(204);
    expect(await repo.findAll()).toEqual([]);
  });
});
