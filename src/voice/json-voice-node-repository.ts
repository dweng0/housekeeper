import { readFile, writeFile } from "fs/promises";
import { join } from "path";
import type { VoiceNode, VoiceNodeRepository } from "../ports.js";

async function read(filePath: string): Promise<VoiceNode[]> {
  try {
    const raw = await readFile(filePath, "utf-8");
    const nodes = JSON.parse(raw) as Partial<VoiceNode>[];
    return nodes.map((n) => ({ transport: "websocket", ...n } as VoiceNode));
  } catch {
    return [];
  }
}

async function write(filePath: string, nodes: VoiceNode[]): Promise<void> {
  await writeFile(filePath, JSON.stringify(nodes, null, 2));
}

export function makeJsonVoiceNodeRepository(filePath: string): VoiceNodeRepository {
  return {
    async findAll() {
      return read(filePath);
    },
    async findById(id) {
      const nodes = await read(filePath);
      return nodes.find((n) => n.id === id) ?? null;
    },
    async save(node) {
      const nodes = await read(filePath);
      const idx = nodes.findIndex((n) => n.id === node.id);
      if (idx >= 0) {
        nodes[idx] = node;
      } else {
        nodes.push(node);
      }
      await write(filePath, nodes);
    },
    async delete(id) {
      const nodes = await read(filePath);
      await write(filePath, nodes.filter((n) => n.id !== id));
    },
  };
}
