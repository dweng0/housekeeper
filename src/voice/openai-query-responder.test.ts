import { describe, it, expect, vi, beforeEach } from "vitest";
import { makeOpenAiQueryResponder } from "./openai-query-responder.js";

const ENDPOINT = "http://llm.local/v1";
const MODEL = "test-model";

function makeFetch(reply: string) {
  return vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ choices: [{ message: { content: reply } }] }),
  });
}

describe("OpenAiQueryResponder", () => {
  it("calls LLM chat completions and returns the response text", async () => {
    const fetch = makeFetch("Chlorophyll absorbs sunlight.");
    const responder = makeOpenAiQueryResponder({ endpoint: ENDPOINT, model: MODEL, fetch });

    const result = await responder.respond("What makes plants green?");

    expect(fetch).toHaveBeenCalledOnce();
    const [url, init] = fetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${ENDPOINT}/chat/completions`);
    const body = JSON.parse(init.body as string);
    expect(body.model).toBe(MODEL);
    expect(body.messages.at(-1)).toEqual({ role: "user", content: "What makes plants green?" });
    expect(result).toBe("Chlorophyll absorbs sunlight.");
  });

  it("injects memories into the system prompt", async () => {
    const fetch = makeFetch("Yes.");
    const responder = makeOpenAiQueryResponder({ endpoint: ENDPOINT, model: MODEL, fetch });

    await responder.respond("Do I have any pets?", { memories: ["user has a cat named Whiskers"] });

    const body = JSON.parse((fetch.mock.calls[0] as [string, RequestInit])[1].body as string);
    const systemContent = body.messages[0].content as string;
    expect(systemContent).toContain("user has a cat named Whiskers");
  });

  it("injects location into the system prompt", async () => {
    const fetch = makeFetch("Yes.");
    const responder = makeOpenAiQueryResponder({ endpoint: ENDPOINT, model: MODEL, fetch });

    await responder.respond("Is it cold here?", { location: "upstairs bedroom" });

    const body = JSON.parse((fetch.mock.calls[0] as [string, RequestInit])[1].body as string);
    const systemContent = body.messages[0].content as string;
    expect(systemContent).toContain("upstairs bedroom");
  });
});
