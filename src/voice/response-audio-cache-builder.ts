import { readFile, writeFile, mkdir, rm } from "fs/promises";
import { join } from "path";
import type { Device, ResponseTextGenerator, TtsRenderer } from "../ports.js";

type CacheIndex = Record<string, { positive: string[] }>;

const NOT_FOUND_KEY = "__not_found__";

function toKey(deviceLabel: string, command: string): string {
  return `${deviceLabel}:${command}`;
}

function toSlug(key: string): string {
  return key.replace(/[^a-zA-Z0-9]/g, "-").toLowerCase();
}

async function readIndex(indexPath: string): Promise<CacheIndex> {
  try {
    const raw = await readFile(indexPath, "utf-8");
    return JSON.parse(raw) as CacheIndex;
  } catch {
    return {};
  }
}

async function allFilesExist(cacheDir: string, paths: string[], expected: number): Promise<boolean> {
  if (paths.length !== expected) return false;
  const checks = await Promise.all(
    paths.map(async (f) => {
      try { await readFile(join(cacheDir, f)); return true; } catch { return false; }
    }),
  );
  return checks.every(Boolean);
}

export interface ResponseAudioCacheBuilder {
  build(devices: Device[]): Promise<void>;
  buildForDevice(device: Device): Promise<void>;
}

export function makeResponseAudioCacheBuilder({
  textGenerator,
  ttsRenderer,
  cacheDir,
  variantCount = 3,
}: {
  textGenerator: ResponseTextGenerator;
  ttsRenderer: TtsRenderer;
  cacheDir: string;
  variantCount?: number;
}): ResponseAudioCacheBuilder {
  const indexPath = join(cacheDir, "index.json");

  async function renderAndSave(key: string, texts: string[]): Promise<string[]> {
    const slug = toSlug(key);
    const dir = join(cacheDir, slug);
    await mkdir(dir, { recursive: true });
    const filePaths: string[] = [];
    for (let i = 0; i < texts.length; i++) {
      const buf = await ttsRenderer.render(texts[i]);
      const filename = `${i}.wav`;
      await writeFile(join(dir, filename), buf);
      filePaths.push(`${slug}/${filename}`);
    }
    return filePaths;
  }

  return {
    async build(devices: Device[]) {
      const index = await readIndex(indexPath);

      const currentPairs = new Map<string, { deviceLabel: string; command: string }>();
      for (const device of devices) {
        if (!device.commandMap) continue;
        for (const command of Object.keys(device.commandMap)) {
          currentPairs.set(toKey(device.label, command), { deviceLabel: device.label, command });
        }
      }

      // Prune orphaned positive entries (never prune __not_found__)
      for (const key of Object.keys(index)) {
        if (key === NOT_FOUND_KEY) continue;
        if (!currentPairs.has(key)) {
          console.log(`[CacheBuilder] pruning orphaned ${key}`);
          await rm(join(cacheDir, toSlug(key)), { recursive: true, force: true });
          delete index[key];
        }
      }

      // Generate missing positive entries
      for (const [key, { deviceLabel, command }] of currentPairs) {
        const entry = index[key];
        if (entry && await allFilesExist(cacheDir, entry.positive, variantCount)) continue;

        console.log(`[CacheBuilder] generating ${key}…`);
        const texts = await textGenerator.generateVariants({ deviceLabel, command, count: variantCount });
        index[key] = { positive: await renderAndSave(key, texts) };
        console.log(`[CacheBuilder] done ${key}`);
      }

      // Generate __not_found__ pool if missing or incomplete
      const nfEntry = index[NOT_FOUND_KEY];
      if (!nfEntry || !(await allFilesExist(cacheDir, nfEntry.positive, variantCount))) {
        console.log(`[CacheBuilder] generating ${NOT_FOUND_KEY}…`);
        const texts = await textGenerator.generateNotFoundVariants({ count: variantCount });
        index[NOT_FOUND_KEY] = { positive: await renderAndSave(NOT_FOUND_KEY, texts) };
        console.log(`[CacheBuilder] done ${NOT_FOUND_KEY}`);
      }

      await mkdir(cacheDir, { recursive: true });
      await writeFile(indexPath, JSON.stringify(index, null, 2), "utf-8");
    },

    async buildForDevice(device: Device) {
      if (!device.commandMap) return;
      const index = await readIndex(indexPath);

      console.log(`[CacheBuilder] new device "${device.label}" — generating cache entries…`);
      let generated = false;

      for (const command of Object.keys(device.commandMap)) {
        const key = toKey(device.label, command);
        const entry = index[key];
        if (entry && await allFilesExist(cacheDir, entry.positive, variantCount)) continue;

        const texts = await textGenerator.generateVariants({ deviceLabel: device.label, command, count: variantCount });
        index[key] = { positive: await renderAndSave(key, texts) };
        generated = true;
      }

      if (generated) {
        await mkdir(cacheDir, { recursive: true });
        await writeFile(indexPath, JSON.stringify(index, null, 2), "utf-8");
      }

      console.log(`[CacheBuilder] ${device.label} entries ready`);
    },
  };
}
