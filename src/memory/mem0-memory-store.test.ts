import { describe, it, expect, vi } from "vitest";
import type { MemoryStore } from "../ports.js";
import { makeMem0MemoryStore } from "./mem0-memory-store.js";

interface Mem0Client {
  add(messages: Array<{ role: string; content: string }>, opts: { user_id: string }): Promise<void>;
  search(query: string, opts: { user_id: string }): Promise<Array<{ memory: string }>>;
  delete_all(opts: { user_id: string }): Promise<void>;
}

function makeMockClient(): { client: Mem0Client; calls: string[] } {
  const calls: string[] = [];
  const memories: Map<string, string[]> = new Map();

  const client: Mem0Client = {
    add: vi.fn(async (messages, { user_id }) => {
      calls.push(`add:${user_id}`);
      const existing = memories.get(user_id) ?? [];
      existing.push(messages[0].content);
      memories.set(user_id, existing);
    }),
    search: vi.fn(async (_query, { user_id }) => {
      calls.push(`search:${user_id}`);
      return (memories.get(user_id) ?? []).map((m) => ({ memory: m }));
    }),
    delete_all: vi.fn(async ({ user_id }) => {
      calls.push(`delete:${user_id}`);
      memories.delete(user_id);
    }),
  };

  return { client, calls };
}

describe("Mem0MemoryStore", () => {
  it("store saves fact for resident", async () => {
    const { client, calls } = makeMockClient();
    const store: MemoryStore = makeMem0MemoryStore(client);
    await store.store("Jay", "Jay prefers lights dim at night");
    expect(calls).toContain("add:Jay");
  });

  it("search returns memories for resident", async () => {
    const { client } = makeMockClient();
    const store: MemoryStore = makeMem0MemoryStore(client);
    await store.store("Jay", "Jay prefers lights dim at night");
    const results = await store.search("Jay", "lights");
    expect(results).toContain("Jay prefers lights dim at night");
  });

  it("clear removes all memories for resident", async () => {
    const { client, calls } = makeMockClient();
    const store: MemoryStore = makeMem0MemoryStore(client);
    await store.store("Jay", "some fact");
    await store.clear("Jay");
    expect(calls).toContain("delete:Jay");
  });

  it("scopes operations by residentId (no cross-contamination)", async () => {
    const { client } = makeMockClient();
    const store: MemoryStore = makeMem0MemoryStore(client);
    await store.store("Jay", "Jay fact");
    await store.store("household", "household fact");
    const jayResults = await store.search("Jay", "fact");
    expect(jayResults).not.toContain("household fact");
    const householdResults = await store.search("household", "fact");
    expect(householdResults).not.toContain("Jay fact");
  });
});
