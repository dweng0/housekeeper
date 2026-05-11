import { describe, it, expect, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, mkdir, unlink } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { makeJsonResponseAudioCache } from "./json-response-audio-cache.js";

async function makeTempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "response-cache-test-"));
}

const DEVICE = "Porch Light";
const COMMAND = "on";
const KEY = `${DEVICE}:${COMMAND}`;

describe("makeJsonResponseAudioCache", () => {
  const tmpDirs: string[] = [];

  afterEach(async () => {
    for (const dir of tmpDirs) {
      await rm(dir, { recursive: true, force: true });
    }
    tmpDirs.length = 0;
  });

  it("returns null when index does not exist", async () => {
    const cacheDir = await makeTempDir();
    tmpDirs.push(cacheDir);
    const cache = makeJsonResponseAudioCache(cacheDir);

    const result = await cache.lookup({ deviceLabel: DEVICE, command: COMMAND });

    expect(result).toBeNull();
  });

  it("returns audio buffer for known device/command", async () => {
    const cacheDir = await makeTempDir();
    tmpDirs.push(cacheDir);

    const audioDir = join(cacheDir, "porch-light-on");
    await mkdir(audioDir, { recursive: true });
    await writeFile(join(audioDir, "0.wav"), Buffer.from("fake-pcm"));
    await writeFile(
      join(cacheDir, "index.json"),
      JSON.stringify({ [KEY]: { positive: ["porch-light-on/0.wav"] } }),
    );

    const cache = makeJsonResponseAudioCache(cacheDir);
    const result = await cache.lookup({ deviceLabel: DEVICE, command: COMMAND });

    expect(result).toEqual(Buffer.from("fake-pcm"));
  });

  it("returns null for unknown device/command", async () => {
    const cacheDir = await makeTempDir();
    tmpDirs.push(cacheDir);

    await writeFile(
      join(cacheDir, "index.json"),
      JSON.stringify({ [KEY]: { positive: ["porch-light-on/0.wav"] } }),
    );

    const cache = makeJsonResponseAudioCache(cacheDir);
    const result = await cache.lookup({ deviceLabel: "Unknown", command: "on" });

    expect(result).toBeNull();
  });

  it("serves subsequent lookups from in-memory index after index.json is deleted", async () => {
    const cacheDir = await makeTempDir();
    tmpDirs.push(cacheDir);

    const audioDir = join(cacheDir, "porch-light-on");
    await mkdir(audioDir, { recursive: true });
    await writeFile(join(audioDir, "0.wav"), Buffer.from("fake-pcm"));
    await writeFile(
      join(cacheDir, "index.json"),
      JSON.stringify({ [KEY]: { positive: ["porch-light-on/0.wav"] } }),
    );

    const cache = makeJsonResponseAudioCache(cacheDir);
    await cache.lookup({ deviceLabel: DEVICE, command: COMMAND }); // primes the in-memory index

    await unlink(join(cacheDir, "index.json")); // delete from disk

    const result = await cache.lookup({ deviceLabel: DEVICE, command: COMMAND });
    expect(result).toEqual(Buffer.from("fake-pcm"));
  });

  it("lookupNotFound returns audio from __not_found__ pool", async () => {
    const cacheDir = await makeTempDir();
    tmpDirs.push(cacheDir);

    const nfDir = join(cacheDir, "--not-found--");
    await mkdir(nfDir, { recursive: true });
    await writeFile(join(nfDir, "0.wav"), Buffer.from("not-found-pcm"));
    await writeFile(
      join(cacheDir, "index.json"),
      JSON.stringify({ "__not_found__": { positive: ["--not-found--/0.wav"] } }),
    );

    const cache = makeJsonResponseAudioCache(cacheDir);
    const result = await cache.lookupNotFound();

    expect(result).toEqual(Buffer.from("not-found-pcm"));
  });

  it("lookupNotFound uses in-memory index after index.json deleted", async () => {
    const cacheDir = await makeTempDir();
    tmpDirs.push(cacheDir);

    const nfDir = join(cacheDir, "--not-found--");
    await mkdir(nfDir, { recursive: true });
    await writeFile(join(nfDir, "0.wav"), Buffer.from("not-found-pcm"));
    await writeFile(
      join(cacheDir, "index.json"),
      JSON.stringify({ "__not_found__": { positive: ["--not-found--/0.wav"] } }),
    );

    const cache = makeJsonResponseAudioCache(cacheDir);
    await cache.lookupNotFound(); // prime
    await unlink(join(cacheDir, "index.json"));

    const result = await cache.lookupNotFound();
    expect(result).toEqual(Buffer.from("not-found-pcm"));
  });
});
