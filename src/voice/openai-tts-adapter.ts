import type { ConfigRepository, SpeechOutput, VoiceNodeHub, AppConfig } from "../ports.js";

function pcmToWav(pcm: Buffer, sampleRate: number, channels: number, bitDepth: number): Buffer {
  const byteRate = sampleRate * channels * bitDepth / 8;
  const blockAlign = channels * bitDepth / 8;
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitDepth, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

interface OpenAiTtsAdapterOptions {
  endpoint: string;
  model?: string;
  voice?: string;
  apiKey?: string;
  voiceNodeHub: VoiceNodeHub;
  config: ConfigRepository;
}

export class OpenAiTtsAdapter implements SpeechOutput {
  private readonly endpoint: string;
  private readonly model: string;
  private readonly voice: string;
  private readonly apiKey: string | undefined;
  private readonly hub: VoiceNodeHub;
  private readonly config: ConfigRepository;

  constructor({ endpoint, model, voice, apiKey, voiceNodeHub, config }: OpenAiTtsAdapterOptions) {
    this.endpoint = endpoint.replace(/\/$/, "");
    this.model = model ?? "tts-1";
    this.voice = voice ?? "alloy";
    this.apiKey = apiKey;
    this.hub = voiceNodeHub;
    this.config = config;
  }

  async speak(text: string, originatingNodeId: string): Promise<void> {
    const [pcm, targetId] = await Promise.all([
      this.render(text),
      this.resolveTarget(originatingNodeId),
    ]);
    if (!targetId) {
      console.warn("[TTS] No speaker node available, dropping response");
      return;
    }
    await this.hub.sendTts(targetId, pcm);
  }

  private async render(text: string): Promise<Buffer> {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (this.apiKey) headers["Authorization"] = `Bearer ${this.apiKey}`;

    const res = await fetch(`${this.endpoint}/v1/audio/speech`, {
      method: "POST",
      headers,
      body: JSON.stringify({ model: this.model, voice: this.voice, input: text, response_format: "pcm" }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`TTS HTTP ${res.status}: ${body}`);
    }

    return Buffer.from(await res.arrayBuffer());
  }

  private async resolveTarget(originatingNodeId: string): Promise<string | null> {
    const originatingNode = this.hub.getNode(originatingNodeId);
    if (originatingNode?.capabilities.includes("speaker")) {
      return originatingNodeId;
    }

    const appConfig: AppConfig = await this.config.get();
    const defaultId = appConfig.defaultOutputNodeId;
    if (!defaultId) {
      console.warn("[TTS] No defaultOutputNodeId configured");
      return null;
    }

    const defaultNode = this.hub.getNode(defaultId);
    if (!defaultNode) {
      console.warn(`[TTS] Default output node ${defaultId} is offline`);
      return null;
    }

    return defaultId;
  }
}
