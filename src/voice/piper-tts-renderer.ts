import { spawn } from "child_process";
import type { TtsRenderer } from "../ports.js";

export function makePiperTtsRenderer(voicePath: string): TtsRenderer {
  return {
    render(text: string): Promise<Buffer> {
      return new Promise((resolve, reject) => {
        const piper = spawn("piper", ["--model", voicePath, "--output-raw"]);
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
    },
  };
}
