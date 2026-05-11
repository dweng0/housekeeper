import { Router } from "express";
import type { VoiceNodeHub, VoiceNodeRepository } from "../ports.js";

interface RouterDeps {
  voiceNodes: VoiceNodeRepository;
  hub: VoiceNodeHub;
}

export function makeVoiceNodeRouter({ voiceNodes, hub }: RouterDeps): Router {
  const router = Router();

  router.get("/unconfirmed", async (_req, res) => {
    const all = await voiceNodes.findAll();
    const connected = new Set(hub.getConnectedNodes().map((n) => n.id));
    res.json(all.filter((n) => !n.confirmed).map((n) => ({ ...n, online: connected.has(n.id) })));
  });

  router.get("/", async (_req, res) => {
    const all = await voiceNodes.findAll();
    const connected = new Set(hub.getConnectedNodes().map((n) => n.id));
    res.json(all.map((n) => ({ ...n, online: connected.has(n.id) })));
  });

  router.put("/:id", async (req, res) => {
    const node = await voiceNodes.findById(req.params.id);
    if (!node) { res.status(404).json({ error: "not found" }); return; }
    const { label, location, confirmed } = req.body as Partial<{ label: string; location: string; confirmed: boolean }>;
    const updated = { ...node, ...(label && { label }), ...(location && { location }), ...(typeof confirmed === "boolean" && { confirmed }) };
    await voiceNodes.save(updated);

    if (confirmed === true && !node.confirmed) {
      hub.onNodeConfirmed?.(node.id);
    }

    if (hub.getNode(node.id)) {
      const patch: Record<string, unknown> = {};
      if (label) patch.label = label;
      if (location) patch.location = location;
      if (Object.keys(patch).length > 0) await hub.sendConfig(node.id, patch);
    }

    res.json(updated);
  });

  router.delete("/:id", async (req, res) => {
    await voiceNodes.delete(req.params.id);
    res.status(204).end();
  });

  return router;
}
