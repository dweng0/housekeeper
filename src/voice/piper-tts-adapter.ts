import { spawn } from "child_process";
import type { AppConfig, ConfigRepository, SpeechOutput, VoiceNodeHub } from "../ports.js";

interface PiperTtsAdapterOptions {
  voicePath: string;
  voiceNodeHub: VoiceNodeHub;
  config: ConfigRepository;
}

export class PiperTtsAdapter implements SpeechOutput {
  private readonly voicePath: string;
  private readonly hub: VoiceNodeHub;
  private readonly config: ConfigRepository;

  constructor({ voicePath, voiceNodeHub, config }: PiperTtsAdapterOptions) {
    this.voicePath = voicePath;
    this.hub = voiceNodeHub;
    this.config = config;
  }

  async speak(text: string, originatingNodeId: string): Promise<void> {
    const pcm = await this.render(text);
    const targetId = await this.resolveTarget(originatingNodeId);
    if (!targetId) {
      console.warn("[TTS] No speaker node available, dropping response");
      return;
    }
    await this.hub.sendTts(targetId, pcm);
  }

  private render(text: string): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const piper = spawn("piper", ["--model", this.voicePath, "--output-raw"]);
      const chunks: Buffer[] = [];

      piper.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
      piper.stdin.write(text);
      piper.stdin.end();

      piper.stderr.on("data", (data: Buffer) => {
        const msg = data.toString();
        if (msg.toLowerCase().includes("error")) {
          reject(new Error(`piper: ${msg.trim()}`));
        }
      });

      piper.on("close", (code) => {
        if (code === 0) resolve(Buffer.concat(chunks));
        else reject(new Error(`piper exited with code ${code}`));
      });

      piper.on("error", reject);
    });
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
