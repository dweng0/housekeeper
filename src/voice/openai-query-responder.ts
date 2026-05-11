import type { QueryResponder, QueryContext } from "../ports.js";

interface OpenAiQueryResponderOptions {
  endpoint: string;
  model: string;
  apiKey?: string;
  fetch?: typeof globalThis.fetch;
}

function buildSystemPrompt(context?: QueryContext): string {
  const parts: string[] = [
    "You are a helpful home assistant. Answer questions conversationally and concisely — two or three sentences maximum. Use natural spoken English. No bullet points, no markdown, no lists.",
  ];

  if (context?.location) {
    parts.push(`The question comes from: ${context.location}.`);
  }

  if (context?.memories && context.memories.length > 0) {
    parts.push(`What you know about this resident:\n${context.memories.map((m) => `- ${m}`).join("\n")}`);
  }

  return parts.join("\n\n");
}

export function makeOpenAiQueryResponder({ endpoint, model, apiKey, fetch: _fetch = globalThis.fetch }: OpenAiQueryResponderOptions): QueryResponder {
  return {
    async respond(query: string, context?: QueryContext): Promise<string> {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;

      const res = await _fetch(`${endpoint.replace(/\/$/, "")}/chat/completions`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: buildSystemPrompt(context) },
            ...(context?.history ?? []),
            { role: "user", content: query },
          ],
        }),
      });

      const data = await res.json() as { choices: { message: { content: string } }[] };
      return data.choices[0].message.content.trim();
    },
  };
}
