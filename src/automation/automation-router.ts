import { Router } from "express";
import { randomUUID } from "crypto";
import type { Automation, AutomationRepository, DeviceRepository } from "../ports.js";

interface RouterDeps {
  automations: AutomationRepository;
  devices: DeviceRepository;
}

async function validateDeviceLabels(
  automation: Omit<Automation, "id">,
  devices: DeviceRepository
): Promise<string | null> {
  const triggerLabel = automation.trigger?.deviceLabel;
  if (!triggerLabel || !(await devices.findByLabel(triggerLabel))) {
    return `Unknown Device Label: "${triggerLabel}"`;
  }
  for (const action of automation.actions ?? []) {
    if (!(await devices.findByLabel(action.deviceLabel))) {
      return `Unknown Device Label: "${action.deviceLabel}"`;
    }
  }
  return null;
}

export function makeAutomationRouter({ automations, devices }: RouterDeps): Router {
  const router = Router();

  router.get("/", async (_req, res) => {
    res.json(await automations.findAll());
  });

  router.post("/", async (req, res) => {
    const { enabled, trigger, actions } = req.body as Partial<Automation>;
    if (!trigger || !actions) {
      res.status(400).json({ error: "trigger and actions are required" });
      return;
    }
    const body = { enabled: enabled ?? true, trigger, actions };
    const labelError = await validateDeviceLabels(body, devices);
    if (labelError) {
      res.status(400).json({ error: labelError });
      return;
    }
    const automation: Automation = { id: randomUUID(), ...body };
    await automations.save(automation);
    res.status(201).json(automation);
  });

  router.put("/:id", async (req, res) => {
    const existing = await automations.findById(req.params.id);
    if (!existing) {
      res.status(404).json({ error: "Automation not found" });
      return;
    }
    const { enabled, trigger, actions } = req.body as Partial<Automation>;
    if (!trigger || !actions) {
      res.status(400).json({ error: "trigger and actions are required" });
      return;
    }
    const body = { enabled: enabled ?? existing.enabled, trigger, actions };
    const labelError = await validateDeviceLabels(body, devices);
    if (labelError) {
      res.status(400).json({ error: labelError });
      return;
    }
    const updated: Automation = { id: req.params.id, ...body };
    await automations.save(updated);
    res.json(updated);
  });

  router.delete("/:id", async (req, res) => {
    await automations.delete(req.params.id);
    res.status(204).end();
  });

  return router;
}
