import { describe, it, expect } from "vitest";
import { makeExpressAudioFileServer } from "./express-audio-file-server.js";
import express from "express";

describe("ExpressAudioFileServer — serveStream", () => {
  it("serveStream returns a URL and cleanup function", async () => {
    const app = express();
    const audioServer = makeExpressAudioFileServer(app, "http://example.com");

    const chunks = [Buffer.from("chunk-1"), Buffer.from("chunk-2")];

    async function* chunkIterator() {
      for (const chunk of chunks) {
        yield chunk;
      }
    }

    const { url, cleanup } = await audioServer.serveStream(chunkIterator());

    // URL should be available immediately
    expect(url).toBeTruthy();
    expect(url).toMatch(/^http:\/\/example\.com\/tts-audio-stream\//);
    expect(typeof cleanup).toBe("function");
  });
});
