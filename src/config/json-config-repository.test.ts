import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFile, writeFile, unlink } from "fs/promises";
import { join } from "path";
import { jsonConfigRepository } from "./json-config-repository.js";

const testConfigPath = join(process.cwd(), "data", "config.test.json");

describe("jsonConfigRepository", () => {
  beforeEach(async () => {
    try {
      await unlink(testConfigPath);
    } catch {}
    process.env.TEST_CONFIG_PATH = testConfigPath;
  });

  afterEach(async () => {
    try {
      await unlink(testConfigPath);
    } catch {}
    delete process.env.TEST_CONFIG_PATH;
  });

  it("returns default persona when none configured", async () => {
    const config = await jsonConfigRepository.get();
    expect(config.persona).toBe("You are a friendly and helpful smart home assistant called {SYSTEM_NAME}. You live in the home and help residents control devices and set up automations.");
  });

  it("returns default systemName when none configured", async () => {
    const config = await jsonConfigRepository.get();
    expect(config.systemName).toBe("housekeeper");
  });

  it("persists persona and systemName to config file", async () => {
    await jsonConfigRepository.save({
      autoDiscovery: true,
      systemName: "Jarvis",
      persona: "You are Jarvis, an AI assistant.",
    });

    const savedRaw = await readFile(testConfigPath, "utf-8");
    const saved = JSON.parse(savedRaw);
    expect(saved.systemName).toBe("Jarvis");
    expect(saved.persona).toBe("You are Jarvis, an AI assistant.");

    const config = await jsonConfigRepository.get();
    expect(config.systemName).toBe("Jarvis");
    expect(config.persona).toBe("You are Jarvis, an AI assistant.");
  });
});