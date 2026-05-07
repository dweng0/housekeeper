import { Router, raw } from "express";
import type { Transcriber } from "../ports.js";

interface TranscribeRouterDeps {
  transcriber: Transcriber;
  hub: { pushUtterance(nodeId: string, transcript: string): void };
}

export function makeTranscribeRouter({ transcriber, hub }: TranscribeRouterDeps): Router {
  const router = Router();

  router.post("/transcribe", raw({ type: "application/octet-stream", limit: "10mb" }), async (req, res) => {
    const nodeId = req.headers["x-node-id"] as string | undefined;
    if (!nodeId) { res.status(400).json({ error: "X-Node-Id header required" }); return; }
    if (!req.body || (req.body as Buffer).length === 0) { res.status(400).json({ error: "audio body required" }); return; }

    try {
      const { transcript } = await transcriber.transcribe(req.body as Buffer);
      hub.pushUtterance(nodeId, transcript);
      res.json({ transcript, nodeId });
    } catch {
      res.status(500).json({ error: "transcription failed" });
    }
  });

  return router;
}
