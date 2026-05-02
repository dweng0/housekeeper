import { readFile, writeFile } from "fs/promises";
import { join } from "path";
import type { AppConfig, ConfigRepository } from "../ports.js";

const filePath = join(process.cwd(), "data", "config.json");

const defaults: AppConfig = { autoDiscovery: false };

export const jsonConfigRepository: ConfigRepository = {
  async get() {
    try {
      const raw = await readFile(filePath, "utf-8");
      return { ...defaults, ...(JSON.parse(raw) as Partial<AppConfig>) };
    } catch {
      return { ...defaults };
    }
  },
  async save(config) {
    await writeFile(filePath, JSON.stringify(config, null, 2));
  },
};
