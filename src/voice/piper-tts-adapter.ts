import { spawn } from "child_process";
import { SpeechOutput } from "../ports.js";

export class PiperTtsAdapter implements SpeechOutput {
  private readonly voicePath: string;

  constructor(voicePath: string) {
    this.voicePath = voicePath;
  }

  speak(text: string): Promise<void> {
    return new Promise((resolve, reject) => {
      // piper reads text from stdin, writes raw PCM to stdout; aplay plays it
      const piper = spawn("piper", [
        "--model", this.voicePath,
        "--output-raw",
      ]);
      const aplay = spawn("aplay", ["-r", "22050", "-f", "S16_LE", "-t", "raw", "-"]);

      piper.stdout.pipe(aplay.stdin);
      piper.stdin.write(text);
      piper.stdin.end();

      piper.stderr.on("data", (data) => {
        // piper writes progress to stderr; ignore unless error
        const msg = data.toString();
        if (msg.toLowerCase().includes("error")) {
          reject(new Error(`piper: ${msg.trim()}`));
        }
      });

      aplay.on("close", (code) => {
        if (code === 0) resolve();
        else reject(new Error(`aplay exited with code ${code}`));
      });

      piper.on("error", reject);
      aplay.on("error", reject);
    });
  }
}
