import { readFile, writeFile } from "fs/promises";
import { join } from "path";
import type { AppConfig, ConfigRepository } from "../ports.js";

function getFilePath() {
  return process.env.TEST_CONFIG_PATH ?? join(process.cwd(), "data", "config.json");
}

const defaults: AppConfig = {
  autoDiscovery: false,
  systemName: "housekeeper",
  persona: "You are a friendly and helpful smart home assistant called {SYSTEM_NAME}. You live in the home and help residents control devices and set up automations.",
  mqttBrokerUrl: "mqtt://localhost:1883",
};

export const jsonConfigRepository: ConfigRepository = {
  async get() {
    try {
      const raw = await readFile(getFilePath(), "utf-8");
      return { ...defaults, ...(JSON.parse(raw) as Partial<AppConfig>) };
    } catch {
      return { ...defaults };
    }
  },
  async save(config) {
    await writeFile(getFilePath(), JSON.stringify(config, null, 2));
  },
};
