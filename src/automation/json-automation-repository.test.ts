import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import type { Automation } from "../ports.js";

// Import will fail until we create the module — that's the RED
import { makeJsonAutomationRepository } from "./json-automation-repository.js";

const automation: Automation = {
  id: "a1",
  enabled: true,
  trigger: { deviceLabel: "Front Door", event: "open" },
  actions: [{ deviceLabel: "Porch Light", command: "on", durationSeconds: 10 }],
};

let dir: string;
let filePath: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "housekeeper-test-"));
  filePath = join(dir, "automations.json");
});

afterEach(async () => {
  await rm(dir, { recursive: true });
});

describe("JsonAutomationRepository", () => {
  it("findAll returns empty array when file does not exist", async () => {
    const repo = makeJsonAutomationRepository(filePath);
    expect(await repo.findAll()).toEqual([]);
  });

  it("save persists automation; findAll returns it", async () => {
    const repo = makeJsonAutomationRepository(filePath);
    await repo.save(automation);
    expect(await repo.findAll()).toEqual([automation]);
  });

  it("findById returns automation by id", async () => {
    const repo = makeJsonAutomationRepository(filePath);
    await repo.save(automation);
    expect(await repo.findById("a1")).toEqual(automation);
  });

  it("findById returns null for unknown id", async () => {
    const repo = makeJsonAutomationRepository(filePath);
    expect(await repo.findById("nope")).toBeNull();
  });

  it("save updates existing automation in-place", async () => {
    const repo = makeJsonAutomationRepository(filePath);
    await repo.save(automation);
    const updated: Automation = { ...automation, enabled: false };
    await repo.save(updated);
    const all = await repo.findAll();
    expect(all).toHaveLength(1);
    expect(all[0].enabled).toBe(false);
  });

  it("delete removes automation by id", async () => {
    const repo = makeJsonAutomationRepository(filePath);
    await repo.save(automation);
    await repo.delete("a1");
    expect(await repo.findAll()).toEqual([]);
  });

  it("save rejects automation referencing unknown Device Label", async () => {
    const repo = makeJsonAutomationRepository(filePath, async (label) => label !== "Front Door");
    await expect(repo.save(automation)).rejects.toThrow(/Front Door/);
  });
});
