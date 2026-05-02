import { readFile, writeFile } from "fs/promises";
import type { Automation, AutomationRepository } from "../ports.js";

type LabelExistsCheck = (label: string) => Promise<boolean>;

async function read(filePath: string): Promise<Automation[]> {
  try {
    const raw = await readFile(filePath, "utf-8");
    return JSON.parse(raw) as Automation[];
  } catch {
    return [];
  }
}

async function write(filePath: string, automations: Automation[]): Promise<void> {
  await writeFile(filePath, JSON.stringify(automations, null, 2));
}

export function makeJsonAutomationRepository(
  filePath: string,
  labelExists?: LabelExistsCheck
): AutomationRepository {
  return {
    async findAll() {
      return read(filePath);
    },
    async findById(id) {
      const all = await read(filePath);
      return all.find((a) => a.id === id) ?? null;
    },
    async save(automation) {
      if (labelExists) {
        const triggerLabel = automation.trigger.deviceLabel;
        if (!(await labelExists(triggerLabel))) {
          throw new Error(`Unknown Device Label: "${triggerLabel}"`);
        }
        for (const action of automation.actions) {
          if (!(await labelExists(action.deviceLabel))) {
            throw new Error(`Unknown Device Label: "${action.deviceLabel}"`);
          }
        }
      }
      const all = await read(filePath);
      const idx = all.findIndex((a) => a.id === automation.id);
      if (idx >= 0) {
        all[idx] = automation;
      } else {
        all.push(automation);
      }
      await write(filePath, all);
    },
    async delete(id) {
      const all = await read(filePath);
      await write(filePath, all.filter((a) => a.id !== id));
    },
  };
}
