import { describe, it, expect, vi, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, mkdir, readFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import type { Device, ResponseTextGenerator, TtsRenderer } from "../ports.js";
import { makeResponseAudioCacheBuilder } from "./response-audio-cache-builder.js";

async function makeTempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "cache-builder-test-"));
}

function makeTextGenerator(variants = ["Done.", "Got it.", "Sure thing."]): ResponseTextGenerator & { calls: { deviceLabel: string; command: string }[] } {
  const calls: { deviceLabel: string; command: string }[] = [];
  const allStopConfirmationVariants = ["Did you want me to stop?", "Should I stop?", "Stop?", "Did you want to stop?", "Stop what I'm doing?", "Stop that?", "Pause?", "Should I pause?", "Stop this?", "End it?"];
  return {
    calls,
    generateVariants: vi.fn(async ({ deviceLabel, command }) => {
      calls.push({ deviceLabel, command });
      return variants;
    }),
    generateNotFoundVariants: vi.fn(async () => ["I don't know that device.", "That device isn't registered.", "No device found."]),
    generateStopConfirmationVariants: vi.fn(async ({ count }) => allStopConfirmationVariants.slice(0, count)),
    generateUnknownIntentVariants: vi.fn(async ({ count }) => {
      const variants = ["I didn't catch that.", "Could you repeat?", "Not sure what you meant.", "Say again?", "I missed that."];
      return variants.slice(0, count);
    }),
  };
}

function makeTtsRenderer(): TtsRenderer & { renderMock: ReturnType<typeof vi.fn> } {
  const renderMock = vi.fn(async (_text: string) => Buffer.from("fake-wav"));
  return { render: renderMock, renderMock };
}

const porchLight: Device = {
  id: "d1",
  label: "Porch Light",
  topic: "home/porch-light",
  type: "actuator",
  commandMap: { on: "1", off: "0" },
};

describe("ResponseAudioCacheBuilder", () => {
  const tmpDirs: string[] = [];

  afterEach(async () => {
    for (const dir of tmpDirs) {
      await rm(dir, { recursive: true, force: true });
    }
    tmpDirs.length = 0;
  });

  it("generates entries for missing device/command pairs", async () => {
    const cacheDir = await makeTempDir();
    tmpDirs.push(cacheDir);
    const textGen = makeTextGenerator();
    const { render, renderMock } = makeTtsRenderer();
    const builder = makeResponseAudioCacheBuilder({ textGenerator: textGen, ttsRenderer: { render }, cacheDir });

    await builder.build([porchLight]);

    expect(textGen.calls).toHaveLength(2);
    expect(textGen.calls).toContainEqual({ deviceLabel: "Porch Light", command: "on" });
    expect(textGen.calls).toContainEqual({ deviceLabel: "Porch Light", command: "off" });
    expect(renderMock).toHaveBeenCalledTimes(15); // 3 variants × 2 commands (6) + 3 for __not_found__ + 3 for __stop_confirmation__ + 3 for __unknown_intent__

    const raw = await readFile(join(cacheDir, "index.json"), "utf-8");
    const index = JSON.parse(raw) as Record<string, { positive: string[] }>;
    expect(index["Porch Light:on"].positive).toHaveLength(3);
    expect(index["Porch Light:off"].positive).toHaveLength(3);
  });

  it("skips entries already present in index with all files on disk", async () => {
    const cacheDir = await makeTempDir();
    tmpDirs.push(cacheDir);

    const slug = "porch-light-on";
    const dir = join(cacheDir, slug);
    await mkdir(dir, { recursive: true });
    for (let i = 0; i < 3; i++) {
      await writeFile(join(dir, `${i}.wav`), Buffer.from("existing"));
    }
    const nfSlug = "--not-found--";
    const nfDir = join(cacheDir, nfSlug);
    await mkdir(nfDir, { recursive: true });
    for (let i = 0; i < 3; i++) {
      await writeFile(join(nfDir, `${i}.wav`), Buffer.from("existing"));
    }
    const scSlug = "--stop-confirmation--";
    const scDir = join(cacheDir, scSlug);
    await mkdir(scDir, { recursive: true });
    for (let i = 0; i < 3; i++) {
      await writeFile(join(scDir, `${i}.wav`), Buffer.from("existing"));
    }
    const uiSlug = "--unknown-intent--";
    const uiDir = join(cacheDir, uiSlug);
    await mkdir(uiDir, { recursive: true });
    for (let i = 0; i < 3; i++) {
      await writeFile(join(uiDir, `${i}.wav`), Buffer.from("existing"));
    }
    await writeFile(
      join(cacheDir, "index.json"),
      JSON.stringify({
        "Porch Light:on": { positive: [`${slug}/0.wav`, `${slug}/1.wav`, `${slug}/2.wav`] },
        "__not_found__": { positive: [`${nfSlug}/0.wav`, `${nfSlug}/1.wav`, `${nfSlug}/2.wav`] },
        "__stop_confirmation__": { positive: [`${scSlug}/0.wav`, `${scSlug}/1.wav`, `${scSlug}/2.wav`] },
        "__unknown_intent__": { positive: [`${uiSlug}/0.wav`, `${uiSlug}/1.wav`, `${uiSlug}/2.wav`] },
      }),
    );

    const textGen = makeTextGenerator();
    const { render } = makeTtsRenderer();
    const builder = makeResponseAudioCacheBuilder({ textGenerator: textGen, ttsRenderer: { render }, cacheDir });

    await builder.build([{ ...porchLight, commandMap: { on: "1" } }]);

    expect(textGen.calls).toHaveLength(0);
    expect(render).not.toHaveBeenCalled();
  });

  it("prunes orphaned entries when device no longer registered", async () => {
    const cacheDir = await makeTempDir();
    tmpDirs.push(cacheDir);

    const slug = "old-device-on";
    const dir = join(cacheDir, slug);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "0.wav"), Buffer.from("orphaned"));
    await writeFile(
      join(cacheDir, "index.json"),
      JSON.stringify({ "Old Device:on": { positive: [`${slug}/0.wav`] } }),
    );

    const textGen = makeTextGenerator();
    const { render } = makeTtsRenderer();
    const builder = makeResponseAudioCacheBuilder({ textGenerator: textGen, ttsRenderer: { render }, cacheDir });

    await builder.build([]);

    const raw = await readFile(join(cacheDir, "index.json"), "utf-8");
    const index = JSON.parse(raw) as Record<string, unknown>;
    expect(index["Old Device:on"]).toBeUndefined();
    await expect(readFile(join(dir, "0.wav"))).rejects.toThrow();
  });

  it("generates __not_found__ pool alongside positive entries", async () => {
    const cacheDir = await makeTempDir();
    tmpDirs.push(cacheDir);
    const textGen = makeTextGenerator();
    const { render } = makeTtsRenderer();
    const builder = makeResponseAudioCacheBuilder({ textGenerator: textGen, ttsRenderer: { render }, cacheDir });

    await builder.build([]);

    const raw = await readFile(join(cacheDir, "index.json"), "utf-8");
    const index = JSON.parse(raw) as Record<string, { positive: string[] }>;
    expect(index["__not_found__"]).toBeDefined();
    expect(index["__not_found__"].positive).toHaveLength(3);
    expect(index["__stop_confirmation__"]).toBeDefined();
    expect(index["__stop_confirmation__"].positive).toHaveLength(3);
  });

  describe("buildForDevice", () => {
    it("generates only the given device's command pairs", async () => {
      const cacheDir = await makeTempDir();
      tmpDirs.push(cacheDir);
      const textGen = makeTextGenerator();
      const { render } = makeTtsRenderer();
      const builder = makeResponseAudioCacheBuilder({ textGenerator: textGen, ttsRenderer: { render }, cacheDir });

      const device: Device = { id: "d1", label: "Hallway Light", topic: "home/hallway", type: "actuator", commandMap: { on: "1", off: "0" } };
      await builder.buildForDevice(device);

      expect(textGen.calls).toHaveLength(2);
      expect(textGen.calls).toContainEqual({ deviceLabel: "Hallway Light", command: "on" });
      expect(textGen.calls).toContainEqual({ deviceLabel: "Hallway Light", command: "off" });

      const raw = await readFile(join(cacheDir, "index.json"), "utf-8");
      const index = JSON.parse(raw) as Record<string, { positive: string[] }>;
      expect(index["Hallway Light:on"].positive).toHaveLength(3);
      expect(index["Hallway Light:off"].positive).toHaveLength(3);
    });

    it("does not prune existing entries for other devices", async () => {
      const cacheDir = await makeTempDir();
      tmpDirs.push(cacheDir);

      const slug = "porch-light-on";
      const dir = join(cacheDir, slug);
      await mkdir(dir, { recursive: true });
      for (let i = 0; i < 3; i++) {
        await writeFile(join(dir, `${i}.wav`), Buffer.from("existing"));
      }
      await writeFile(
        join(cacheDir, "index.json"),
        JSON.stringify({ "Porch Light:on": { positive: [`${slug}/0.wav`, `${slug}/1.wav`, `${slug}/2.wav`] } }),
      );

      const textGen = makeTextGenerator();
      const { render } = makeTtsRenderer();
      const builder = makeResponseAudioCacheBuilder({ textGenerator: textGen, ttsRenderer: { render }, cacheDir });

      const device: Device = { id: "d2", label: "Hallway Light", topic: "home/hallway", type: "actuator", commandMap: { on: "1" } };
      await builder.buildForDevice(device);

      const raw = await readFile(join(cacheDir, "index.json"), "utf-8");
      const index = JSON.parse(raw) as Record<string, { positive: string[] }>;
      expect(index["Porch Light:on"]).toBeDefined();
      expect(index["Hallway Light:on"]).toBeDefined();
    });

    it("skips already-complete entries for the device", async () => {
      const cacheDir = await makeTempDir();
      tmpDirs.push(cacheDir);

      const slug = "hallway-light-on";
      const dir = join(cacheDir, slug);
      await mkdir(dir, { recursive: true });
      for (let i = 0; i < 3; i++) {
        await writeFile(join(dir, `${i}.wav`), Buffer.from("existing"));
      }
      await writeFile(
        join(cacheDir, "index.json"),
        JSON.stringify({ "Hallway Light:on": { positive: [`${slug}/0.wav`, `${slug}/1.wav`, `${slug}/2.wav`] } }),
      );

      const textGen = makeTextGenerator();
      const { render, renderMock } = makeTtsRenderer();
      const builder = makeResponseAudioCacheBuilder({ textGenerator: textGen, ttsRenderer: { render }, cacheDir });

      const device: Device = { id: "d1", label: "Hallway Light", topic: "home/hallway", type: "actuator", commandMap: { on: "1" } };
      await builder.buildForDevice(device);

      expect(textGen.calls).toHaveLength(0);
      expect(renderMock).not.toHaveBeenCalled();
    });
  });

  it("skips __not_found__ pool when already present with all files", async () => {
    const cacheDir = await makeTempDir();
    tmpDirs.push(cacheDir);

    const slug = "--not-found--";
    const dir = join(cacheDir, slug);
    await mkdir(dir, { recursive: true });
    for (let i = 0; i < 3; i++) {
      await writeFile(join(dir, `${i}.wav`), Buffer.from("existing"));
    }
    const scSlug = "--stop-confirmation--";
    const scDir = join(cacheDir, scSlug);
    await mkdir(scDir, { recursive: true });
    for (let i = 0; i < 3; i++) {
      await writeFile(join(scDir, `${i}.wav`), Buffer.from("existing"));
    }
    const uiSlug = "--unknown-intent--";
    const uiDir = join(cacheDir, uiSlug);
    await mkdir(uiDir, { recursive: true });
    for (let i = 0; i < 3; i++) {
      await writeFile(join(uiDir, `${i}.wav`), Buffer.from("existing"));
    }
    await writeFile(
      join(cacheDir, "index.json"),
      JSON.stringify({
        "__not_found__": { positive: [`${slug}/0.wav`, `${slug}/1.wav`, `${slug}/2.wav`] },
        "__stop_confirmation__": { positive: [`${scSlug}/0.wav`, `${scSlug}/1.wav`, `${scSlug}/2.wav`] },
        "__unknown_intent__": { positive: [`${uiSlug}/0.wav`, `${uiSlug}/1.wav`, `${uiSlug}/2.wav`] },
      }),
    );

    const textGen = makeTextGenerator();
    const { render, renderMock } = makeTtsRenderer();
    const builder = makeResponseAudioCacheBuilder({ textGenerator: textGen, ttsRenderer: { render }, cacheDir });

    await builder.build([]);

    expect(textGen.calls).toHaveLength(0);
    expect(renderMock).not.toHaveBeenCalled();
  });

  it("generates __stop_confirmation__ pool with variants and updates index", async () => {
    const cacheDir = await makeTempDir();
    tmpDirs.push(cacheDir);
    const stopConfirmationVariants = ["Did you want me to stop?", "Should I stop?", "Stop?", "Did you want to stop?", "Stop what I'm doing?", "Stop that?", "Pause?", "Should I pause?", "Stop this?", "End it?"];
    const textGen = makeTextGenerator();
    // Override to return exactly 10 for stop confirmation
    textGen.generateStopConfirmationVariants = vi.fn(async () => stopConfirmationVariants);
    const { render, renderMock } = makeTtsRenderer();
    const builder = makeResponseAudioCacheBuilder({ textGenerator: textGen, ttsRenderer: { render }, cacheDir, variantCount: 10 });

    await builder.build([]);

    const raw = await readFile(join(cacheDir, "index.json"), "utf-8");
    const index = JSON.parse(raw) as Record<string, { positive: string[] }>;
    expect(index["__stop_confirmation__"]).toBeDefined();
    expect(index["__stop_confirmation__"].positive).toHaveLength(10);
    // slug transformation converts underscores to dashes
    expect(index["__stop_confirmation__"].positive[0]).toBe("--stop-confirmation--/0.wav");
    expect(textGen.generateStopConfirmationVariants).toHaveBeenCalledWith({ count: 10 });
  });

  it("skips __stop_confirmation__ pool when already present with all files", async () => {
    const cacheDir = await makeTempDir();
    tmpDirs.push(cacheDir);

    const slug = "--stop-confirmation--";
    const dir = join(cacheDir, slug);
    await mkdir(dir, { recursive: true });
    for (let i = 0; i < 3; i++) {
      await writeFile(join(dir, `${i}.wav`), Buffer.from("existing"));
    }
    const nfSlug = "--not-found--";
    const nfDir = join(cacheDir, nfSlug);
    await mkdir(nfDir, { recursive: true });
    for (let i = 0; i < 3; i++) {
      await writeFile(join(nfDir, `${i}.wav`), Buffer.from("existing"));
    }
    const uiSlug = "--unknown-intent--";
    const uiDir = join(cacheDir, uiSlug);
    await mkdir(uiDir, { recursive: true });
    for (let i = 0; i < 3; i++) {
      await writeFile(join(uiDir, `${i}.wav`), Buffer.from("existing"));
    }
    await writeFile(
      join(cacheDir, "index.json"),
      JSON.stringify({
        "__stop_confirmation__": { positive: [`${slug}/0.wav`, `${slug}/1.wav`, `${slug}/2.wav`] },
        "__not_found__": { positive: [`${nfSlug}/0.wav`, `${nfSlug}/1.wav`, `${nfSlug}/2.wav`] },
        "__unknown_intent__": { positive: [`${uiSlug}/0.wav`, `${uiSlug}/1.wav`, `${uiSlug}/2.wav`] },
      }),
    );

    const textGen = makeTextGenerator();
    const { render, renderMock } = makeTtsRenderer();
    const builder = makeResponseAudioCacheBuilder({ textGenerator: textGen, ttsRenderer: { render }, cacheDir });

    await builder.build([]);

    expect(textGen.generateStopConfirmationVariants).not.toHaveBeenCalled();
    expect(renderMock).not.toHaveBeenCalled();
  });
});
