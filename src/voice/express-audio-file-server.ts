import { randomUUID } from "crypto";
import type { Express } from "express";
import type { AudioFileServer } from "../ports.js";

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

export function makeExpressAudioFileServer(app: Express, baseUrl: string): AudioFileServer {
  const files = new Map<string, Buffer>();

  app.get("/tts-audio/:token", (req, res) => {
    const buf = files.get(req.params.token);
    if (!buf) { res.status(404).end(); return; }
    res.set("Content-Type", "audio/wav");
    res.send(buf);
  });

  return {
    async serve(audio) {
      const token = randomUUID();
      // Wrap raw PCM in WAV for Cast devices (24kHz, mono, 16-bit)
      files.set(token, pcmToWav(audio, 24000, 1, 16));
      return {
        url: `${baseUrl}/tts-audio/${token}`,
        cleanup: () => files.delete(token),
      };
    },
  };
}
