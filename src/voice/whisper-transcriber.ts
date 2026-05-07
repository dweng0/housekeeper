import { spawn } from "child_process";
import { writeFile, readFile, unlink } from "fs/promises";
import { tmpdir } from "os";
import { join, basename } from "path";
import { randomUUID } from "crypto";
import type { Transcriber, TranscriptResult } from "../ports.js";

export class WhisperTranscriber implements Transcriber {
  constructor(
    private readonly whisperBin: string = "whisper",
    private readonly model: string = "base.en",
  ) {}

  async transcribe(audio: Buffer): Promise<TranscriptResult> {
    const id = randomUUID();
    const outDir = tmpdir();
    const wavPath = join(outDir, `utterance-${id}.wav`);
    const txtPath = join(outDir, `utterance-${id}.txt`);
    try {
      await writeFile(wavPath, wrapPcmInWav(audio));
      await runWhisper(this.whisperBin, this.model, wavPath, outDir);
      const transcript = (await readFile(txtPath, "utf8")).trim();
      return { transcript };
    } finally {
      await unlink(wavPath).catch(() => {});
      await unlink(txtPath).catch(() => {});
    }
  }
}

function wrapPcmInWav(pcm: Buffer): Buffer {
  const sampleRate = 16000;
  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = (sampleRate * numChannels * bitsPerSample) / 8;
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const header = Buffer.alloc(44);

  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(numChannels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);

  return Buffer.concat([header, pcm]);
}

function runWhisper(bin: string, model: string, audioPath: string, outputDir: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(bin, [
      audioPath,
      "--model", model,
      "--output_format", "txt",
      "--output_dir", outputDir,
      "--fp16", "False",
    ]);
    let stderr = "";
    proc.stderr.on("data", (d: Buffer) => { stderr += d.toString(); });
    proc.on("close", (code) => {
      if (code !== 0) { reject(new Error(`whisper exited ${code}: ${stderr}`)); return; }
      resolve();
    });
    proc.on("error", reject);
  });
}
