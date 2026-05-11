import { readFile } from "fs/promises";
import { join } from "path";
import type { ResponseAudioCache } from "../ports.js";

type CacheIndex = Record<string, { positive: string[] }>;

export function makeJsonResponseAudioCache(cacheDir: string): ResponseAudioCache {
  const indexPath = join(cacheDir, "index.json");
  let cachedIndex: CacheIndex | null = null;

  async function getIndex(): Promise<CacheIndex> {
    if (cachedIndex !== null) return cachedIndex;
    try {
      const raw = await readFile(indexPath, "utf-8");
      cachedIndex = JSON.parse(raw) as CacheIndex;
    } catch {
      cachedIndex = {};
    }
    return cachedIndex;
  }

  async function pickRandom(variants: string[]): Promise<Buffer | null> {
    if (variants.length === 0) return null;
    const chosen = variants[Math.floor(Math.random() * variants.length)];
    try {
      return await readFile(join(cacheDir, chosen));
    } catch {
      return null;
    }
  }

  return {
    async lookup({ deviceLabel, command }) {
      const key = `${deviceLabel}:${command}`;
      const index = await getIndex();
      const entry = index[key];
      if (!entry) return null;
      return pickRandom(entry.positive);
    },

    async lookupNotFound() {
      const index = await getIndex();
      const entry = index["__not_found__"];
      if (!entry) return null;
      return pickRandom(entry.positive);
    },
  };
}
