import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { makeJsonVoiceNodeRepository } from "./json-voice-node-repository.js";
import type { VoiceNode } from "../ports.js";

const node1: VoiceNode = { id: "n1", label: "Hallway", location: "downstairs hallway", capabilities: ["mic"], confirmed: false, transport: "websocket" };
const node2: VoiceNode = { id: "n2", label: "Kitchen", location: "kitchen", capabilities: ["mic", "speaker"], confirmed: true, transport: "websocket" };

let dir: string;
let filePath: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "vnrepo-"));
  filePath = join(dir, "voice-nodes.json");
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("JsonVoiceNodeRepository", () => {
  it("returns empty array when file does not exist", async () => {
    const repo = makeJsonVoiceNodeRepository(filePath);
    expect(await repo.findAll()).toEqual([]);
  });

  it("saves new node and retrieves by id", async () => {
    const repo = makeJsonVoiceNodeRepository(filePath);
    await repo.save(node1);
    expect(await repo.findById("n1")).toEqual(node1);
  });

  it("returns null for unknown id", async () => {
    const repo = makeJsonVoiceNodeRepository(filePath);
    expect(await repo.findById("unknown")).toBeNull();
  });

  it("updates existing node in place", async () => {
    const repo = makeJsonVoiceNodeRepository(filePath);
    await repo.save(node1);
    const updated: VoiceNode = { ...node1, label: "Front Hall", confirmed: true };
    await repo.save(updated);
    const all = await repo.findAll();
    expect(all).toHaveLength(1);
    expect(all[0].label).toBe("Front Hall");
    expect(all[0].confirmed).toBe(true);
  });

  it("findAll returns all saved nodes", async () => {
    const repo = makeJsonVoiceNodeRepository(filePath);
    await repo.save(node1);
    await repo.save(node2);
    const all = await repo.findAll();
    expect(all).toHaveLength(2);
    expect(all.map((n) => n.id)).toContain("n1");
    expect(all.map((n) => n.id)).toContain("n2");
  });

  it("deletes node, leaves others", async () => {
    const repo = makeJsonVoiceNodeRepository(filePath);
    await repo.save(node1);
    await repo.save(node2);
    await repo.delete("n1");
    const all = await repo.findAll();
    expect(all).toHaveLength(1);
    expect(all[0].id).toBe("n2");
  });

  it("delete on unknown id is a no-op", async () => {
    const repo = makeJsonVoiceNodeRepository(filePath);
    await repo.save(node1);
    await repo.delete("ghost");
    expect(await repo.findAll()).toHaveLength(1);
  });
});
