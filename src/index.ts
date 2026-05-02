import express from "express";
import { join } from "path";
import { randomUUID } from "crypto";
import { jsonDeviceRepository } from "./device/json-device-repository.js";
import { jsonConfigRepository } from "./config/json-config-repository.js";
import { createAutoDiscoveryService } from "./device/auto-discovery-service.js";
import { makeJsonAutomationRepository } from "./automation/json-automation-repository.js";
import { makeAutomationRouter } from "./automation/automation-router.js";
import { makeAutomationEngine } from "./automation/automation-engine.js";
import { mqttDeviceGateway } from "./mqtt/mqtt-device-gateway.js";
import type { AppConfig, Device } from "./ports.js";

const app = express();
const port = Number(process.env.PORT ?? 3000);

app.use(express.json());

const discovery = createAutoDiscoveryService(jsonDeviceRepository);

const automationDataPath = join(process.cwd(), "data", "automations.json");
const automationRepository = makeJsonAutomationRepository(
  automationDataPath,
  async (label) => (await jsonDeviceRepository.findByLabel(label)) !== null
);

const automationEngine = makeAutomationEngine({
  devices: jsonDeviceRepository,
  automations: automationRepository,
  gateway: mqttDeviceGateway,
});

automationEngine.start();

async function syncDiscovery(config: AppConfig) {
  if (config.autoDiscovery) {
    discovery.start();
  } else {
    discovery.stop();
  }
}

// Boot: apply persisted config
jsonConfigRepository.get().then(syncDiscovery);

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

// --- Config ---

app.get("/api/config", async (_req, res) => {
  const config = await jsonConfigRepository.get();
  res.json(config);
});

app.put("/api/config", async (req, res) => {
  const current = await jsonConfigRepository.get();
  const { autoDiscovery } = req.body as Partial<AppConfig>;
  if (typeof autoDiscovery !== "boolean") {
    res.status(400).json({ error: "autoDiscovery must be a boolean" });
    return;
  }
  const updated: AppConfig = { ...current, autoDiscovery };
  await jsonConfigRepository.save(updated);
  await syncDiscovery(updated);
  res.json(updated);
});

// --- Unregistered devices (auto-discovery) ---

app.get("/api/unregistered-devices", async (_req, res) => {
  const config = await jsonConfigRepository.get();
  if (!config.autoDiscovery) {
    res.json([]);
    return;
  }
  const topics = discovery.getUnregisteredTopics();
  res.json(topics.map((topic) => ({ topic })));
});

// --- Automations ---

app.use("/api/automations", makeAutomationRouter({
  automations: automationRepository,
  devices: jsonDeviceRepository,
}));

// --- Devices ---

app.get("/api/devices", async (_req, res) => {
  const devices = await jsonDeviceRepository.findAll();
  res.json(devices);
});

app.post("/api/devices", async (req, res) => {
  const { label, topic, type } = req.body as Partial<Device>;
  if (!label) {
    res.status(400).json({ error: "label is required" });
    return;
  }
  if (!topic || !type) {
    res.status(400).json({ error: "topic and type are required" });
    return;
  }
  if (type !== "sensor" && type !== "actuator") {
    res.status(400).json({ error: "type must be sensor or actuator" });
    return;
  }
  const device: Device = { id: randomUUID(), label, topic, type };
  await jsonDeviceRepository.save(device);
  res.status(201).json(device);
});

app.put("/api/devices/:id", async (req, res) => {
  const { id } = req.params;
  const { label, topic, type } = req.body as Partial<Device>;
  if (!label) {
    res.status(400).json({ error: "label is required" });
    return;
  }
  if (!topic || !type) {
    res.status(400).json({ error: "topic and type are required" });
    return;
  }
  if (type !== "sensor" && type !== "actuator") {
    res.status(400).json({ error: "type must be sensor or actuator" });
    return;
  }
  const device: Device = { id, label, topic, type };
  await jsonDeviceRepository.save(device);
  res.json(device);
});

app.delete("/api/devices/:id", async (req, res) => {
  await jsonDeviceRepository.delete(req.params.id);
  res.status(204).end();
});

const clientDist = join(process.cwd(), "client", "dist");
app.use(express.static(clientDist));
app.get("*", (_req, res) => {
  res.sendFile(join(clientDist, "index.html"));
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
