import { describe, it, expect } from "vitest";
import express from "express";
import request from "supertest";
import type { Transcriber } from "../ports.js";
import { makeTranscribeRouter } from "./transcribe-router.js";

function makeTranscriber(transcript = "hello world"): Transcriber {
  return { transcribe: async () => ({ transcript }) };
}

function makeHub() {
  const utterances: { nodeId: string; transcript: string }[] = [];
  return {
    utterances,
    pushUtterance: (nodeId: string, transcript: string) => { utterances.push({ nodeId, transcript }); },
  };
}

function makeApp(transcriber: Transcriber, hub = makeHub()) {
  const app = express();
  app.use("/api/voice", makeTranscribeRouter({ transcriber, hub }));
  return app;
}

describe("POST /api/voice/transcribe", () => {
  it("returns transcript and nodeId when valid audio and header provided", async () => {
    const audio = Buffer.from([0x00, 0x01, 0x02]);
    const res = await request(makeApp(makeTranscriber("turn on the lights")))
      .post("/api/voice/transcribe")
      .set("X-Node-Id", "node-abc")
      .set("Content-Type", "application/octet-stream")
      .send(audio);
    expect(res.status).toBe(200);
    expect(res.body.transcript).toBe("turn on the lights");
    expect(res.body.nodeId).toBe("node-abc");
  });

  it("returns 400 when X-Node-Id header is missing", async () => {
    const audio = Buffer.from([0x00, 0x01, 0x02]);
    const res = await request(makeApp(makeTranscriber()))
      .post("/api/voice/transcribe")
      .set("Content-Type", "application/octet-stream")
      .send(audio);
    expect(res.status).toBe(400);
  });

  it("returns 400 when body is empty", async () => {
    const res = await request(makeApp(makeTranscriber()))
      .post("/api/voice/transcribe")
      .set("X-Node-Id", "node-abc")
      .set("Content-Type", "application/octet-stream")
      .send(Buffer.alloc(0));
    expect(res.status).toBe(400);
  });

  it("calls hub.pushUtterance with nodeId and transcript after transcription", async () => {
    const hub = makeHub();
    const audio = Buffer.from([0x00, 0x01]);
    await request(makeApp(makeTranscriber("hello"), hub))
      .post("/api/voice/transcribe")
      .set("X-Node-Id", "node-abc")
      .set("Content-Type", "application/octet-stream")
      .send(audio);
    expect(hub.utterances).toEqual([{ nodeId: "node-abc", transcript: "hello" }]);
  });

  it("returns 500 when transcriber throws", async () => {
    const failing: Transcriber = { transcribe: async () => { throw new Error("whisper failed"); } };
    const audio = Buffer.from([0x00, 0x01]);
    const res = await request(makeApp(failing))
      .post("/api/voice/transcribe")
      .set("X-Node-Id", "node-abc")
      .set("Content-Type", "application/octet-stream")
      .send(audio);
    expect(res.status).toBe(500);
  });
});
