import type { TtsRenderer } from "../ports.js";

interface OpenAITtsRendererOptions {
  endpoint: string;
  model?: string;
  voice?: string;
  apiKey?: string;
}

export function makeOpenAITtsRenderer({ endpoint, model, voice, apiKey }: OpenAITtsRendererOptions): TtsRenderer {
  const base = endpoint.replace(/\/$/, "");
  const resolvedModel = model ?? "tts-1";
  const resolvedVoice = voice ?? "alloy";

  return {
    async render(text: string): Promise<Buffer> {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;

      const res = await fetch(`${base}/v1/audio/speech`, {
        method: "POST",
        headers,
        body: JSON.stringify({ model: resolvedModel, voice: resolvedVoice, input: text, response_format: "pcm" }),
      });

      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`TTS HTTP ${res.status}: ${body}`);
      }

      return Buffer.from(await res.arrayBuffer());
    },
  };
}
