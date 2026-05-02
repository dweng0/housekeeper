import type { MemoryStore } from "../ports.js";

interface Mem0Client {
  add(messages: Array<{ role: string; content: string }>, opts: { user_id: string }): Promise<void>;
  search(query: string, opts: { user_id: string }): Promise<Array<{ memory: string }>>;
  delete_all(opts: { user_id: string }): Promise<void>;
}

export function makeMem0MemoryStore(client: Mem0Client): MemoryStore {
  return {
    async store(residentId, fact) {
      await client.add([{ role: "user", content: fact }], { user_id: residentId });
    },
    async search(residentId, query) {
      const results = await client.search(query, { user_id: residentId });
      return results.map((r) => r.memory);
    },
    async clear(residentId) {
      await client.delete_all({ user_id: residentId });
    },
  };
}
