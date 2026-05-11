import type { ResponseTextGenerator } from "../ports.js";

interface OpenAIResponseTextGeneratorOptions {
  endpoint: string;
  model: string;
  apiKey?: string;
}

export function makeOpenAIResponseTextGenerator(opts: OpenAIResponseTextGeneratorOptions): ResponseTextGenerator {
  async function callLlm(systemPrompt: string, userPrompt: string, count: number): Promise<string[]> {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (opts.apiKey) headers["Authorization"] = `Bearer ${opts.apiKey}`;

    const response = await fetch(`${opts.endpoint}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: opts.model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        response_format: { type: "json_object" },
      }),
    });

    const data = await response.json() as { choices: { message: { content: string } }[] };
    const content = data.choices[0].message.content;

    let jsonStr = content.trim();
    if (jsonStr.startsWith("```")) {
      jsonStr = jsonStr.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
    }

    const parsed = JSON.parse(jsonStr) as { variants?: string[] };
    return (parsed.variants ?? []).slice(0, count);
  }

  return {
    async generateVariants({ deviceLabel, command, persona, count }) {
      const systemPrompt = persona
        ? `${persona}\n\nGenerate natural spoken confirmation phrases.`
        : "You are a home automation assistant. Generate natural spoken confirmation phrases.";

      const userPrompt = `Generate ${count} distinct spoken confirmation phrases for the action "${command}" on "${deviceLabel}". Each should be a complete sentence, brief (under 10 words), and vary in phrasing. Return JSON: { "variants": ["...", "..."] }`;

      return callLlm(systemPrompt, userPrompt, count);
    },

    async generateNotFoundVariants({ persona, count }) {
      const systemPrompt = persona
        ? `${persona}\n\nGenerate natural spoken phrases for when a device is not registered.`
        : "You are a home automation assistant. Generate natural spoken phrases for when a device is not registered.";

      const userPrompt = `Generate ${count} distinct spoken phrases to say when a requested device isn't registered. Keep each brief (under 12 words), natural, and vary phrasing. Do not mention a specific device name. Return JSON: { "variants": ["...", "..."] }`;

      return callLlm(systemPrompt, userPrompt, count);
    },

    async generateStopConfirmationVariants({ persona, count }) {
      const systemPrompt = persona
        ? `${persona}\n\nGenerate natural spoken confirmation phrases for stopping an action.`
        : "You are a home automation assistant. Generate natural spoken confirmation phrases for stopping an action.";

      const userPrompt = `Generate ${count} distinct spoken confirmation phrases to verify that the user wants to stop the current action. Each should be a question or clarification, brief (under 12 words), natural, and vary phrasing. Examples: "Did you want me to stop?", "Should I stop what I'm doing?". Return JSON: { "variants": ["...", "..."] }`;

      return callLlm(systemPrompt, userPrompt, count);
    },
  };
}
