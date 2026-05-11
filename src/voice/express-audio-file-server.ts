import { randomUUID } from "crypto";
import { PassThrough } from "stream";
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
  const streams = new Map<string, PassThrough>();

  app.get("/tts-audio/:token", (req, res) => {
    const buf = files.get(req.params.token);
    if (!buf) { res.status(404).end(); return; }
    res.set("Content-Type", "audio/wav");
    res.send(buf);
  });

  app.get("/tts-audio-stream/:token", (req, res) => {
    const stream = streams.get(req.params.token);
    if (!stream) { res.status(404).end(); return; }
    res.set("Content-Type", "audio/wav");
    stream.pipe(res);
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

    async serveStream(chunks) {
      const token = randomUUID();
      const stream = new PassThrough();
      streams.set(token, stream);

      // Write WAV header with infinite data size (0xFFFFFFFF)
      const header = Buffer.alloc(44);
      header.write("RIFF", 0);
      header.writeUInt32LE(0xFFFFFFFF - 8, 4); // Total file size - 8
      header.write("WAVE", 8);
      header.write("fmt ", 12);
      header.writeUInt32LE(16, 16);
      header.writeUInt16LE(1, 20); // PCM
      header.writeUInt16LE(1, 22); // Mono
      header.writeUInt32LE(24000, 24); // 24 kHz
      header.writeUInt32LE(24000 * 1 * 16 / 8, 28); // Byte rate
      header.writeUInt16LE(1 * 16 / 8, 32); // Block align
      header.writeUInt16LE(16, 34); // Bits per sample
      header.write("data", 36);
      header.writeUInt32LE(0xFFFFFFFF, 40); // Data size (infinite)

      stream.write(header);

      // Stream chunks as they arrive
      (async () => {
        try {
          for await (const chunk of chunks) {
            stream.write(chunk);
          }
        } catch (err) {
          console.error("[AudioFileServer] Error streaming chunks:", err);
        } finally {
          stream.end();
        }
      })();

      // Clean up after 30 seconds
      const timeout = setTimeout(() => {
        streams.delete(token);
        stream.destroy();
      }, 30_000);

      return {
        url: `${baseUrl}/tts-audio-stream/${token}`,
        cleanup: () => {
          clearTimeout(timeout);
          streams.delete(token);
          stream.destroy();
        },
      };
    },
  };
}
