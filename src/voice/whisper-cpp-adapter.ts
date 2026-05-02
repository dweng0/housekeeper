import { spawn, ChildProcess } from "child_process";
import { SpeechInput } from "../ports.js";

export interface WhisperCppAdapterOptions {
  modelPath: string;
  vadModelPath?: string;
  vadSilenceDurationMs?: number;
  onUtterance: (transcript: string) => void;
}

const TIMESTAMP_REGEX = /^\[\d{2}:\d{2}:\d{2}\.\d{3} --> \d{2}:\d{2}:\d{2}\.\d{3}\]\s+(.+)$/;

export class WhisperCppAdapter implements SpeechInput {
  private readonly options: WhisperCppAdapterOptions;
  private process: ChildProcess | null = null;

  constructor(options: WhisperCppAdapterOptions) {
    this.options = options;
  }

  processLine(line: string): void {
    const match = line.match(TIMESTAMP_REGEX);
    if (match) {
      const text = match[1].trim();
      this.options.onUtterance(text);
    }
  }

  startListening(): void {
    const args = [
      "--model", this.options.modelPath,
      "--step", "0",
      "--length", "30000",
    ];

    if (this.options.vadModelPath) {
      args.push("--vad", "--vad-model", this.options.vadModelPath);
    }

    if (this.options.vadSilenceDurationMs) {
      args.push("--vad-min-silence-duration-ms", String(this.options.vadSilenceDurationMs));
    }

    this.process = spawn("whisper-stream", args);

    this.process.stdout?.on("data", (data) => {
      const lines = data.toString().split("\n");
      for (const line of lines) {
        this.processLine(line);
      }
    });
  }

  stopListening(): void {
    if (this.process) {
      this.process.kill();
      this.process = null;
    }
  }

  onUtterance(handler: (transcript: string) => void): void {
    this.options.onUtterance = handler;
  }
}