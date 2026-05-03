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
import { makeWebSocketVoiceNodeHub } from "./voice/websocket-voice-node-hub.js";
import { makeJsonVoiceNodeRepository } from "./voice/json-voice-node-repository.js";
import { makeVoiceNodeRouter } from "./voice/voice-node-router.js";
import { makeVoiceAutomationService } from "./voice/voice-automation-service.js";
import { makeOpenAIIntentClassifier } from "./voice/openai-intent-classifier.js";
import { PiperTtsAdapter } from "./voice/piper-tts-adapter.js";
import { makeLogStore } from "./log-store.js";
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

const logStore = makeLogStore();

const automationEngine = makeAutomationEngine({
  devices: jsonDeviceRepository,
  automations: automationRepository,
  gateway: mqttDeviceGateway,
  logStore,
});

automationEngine.start();

const voiceNodeDataPath = join(process.cwd(), "data", "voice-nodes.json");
const voiceNodeRepository = makeJsonVoiceNodeRepository(voiceNodeDataPath);

const voiceNodePort = Number(process.env.VOICE_NODE_PORT ?? 3001);
const voiceNodeHub = makeWebSocketVoiceNodeHub(voiceNodeRepository, voiceNodePort);

const classifier = makeOpenAIIntentClassifier({
  endpoint: process.env.LLM_ENDPOINT ?? "http://localhost:11434/v1",
  model: process.env.LLM_MODEL ?? "llama3.2",
  devices: jsonDeviceRepository,
});

const piperVoice = process.env.PIPER_VOICE ?? "data/piper-voices/en_US-lessac-medium.onnx";
const speechOutput = new PiperTtsAdapter({
  voicePath: piperVoice,
  voiceNodeHub,
  config: jsonConfigRepository,
});

const voiceService = makeVoiceAutomationService({
  voiceNodeHub,
  systemName: process.env.SYSTEM_NAME ?? "housekeeper",
  classifier,
  devices: jsonDeviceRepository,
  automations: automationRepository,
  speechOutput,
  logStore,
});

voiceService.start();

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
  res.json({
    status: "ok",
    voiceNodes: {
      connected: voiceNodeHub.getConnectedNodes().length,
      nodes: voiceNodeHub.getConnectedNodes().map((n) => ({ id: n.id, label: n.label, location: n.location })),
    },
  });
});

app.get("/api/logs", (_req, res) => {
  const { type } = _req.query;
  const all = logStore.getAll();
  const filtered = type ? all.filter((e) => e.type === type) : all;
  res.json(filtered);
});

// --- Config ---

app.get("/api/config", async (_req, res) => {
  const config = await jsonConfigRepository.get();
  res.json(config);
});

app.put("/api/config", async (req, res) => {
  const current = await jsonConfigRepository.get();
  const { autoDiscovery, defaultOutputNodeId } = req.body as Partial<AppConfig>;
  if (typeof autoDiscovery !== "boolean") {
    res.status(400).json({ error: "autoDiscovery must be a boolean" });
    return;
  }
  const updated: AppConfig = { ...current, autoDiscovery, defaultOutputNodeId };
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

// --- Voice Nodes ---

app.use("/api/voice-nodes", makeVoiceNodeRouter({ voiceNodes: voiceNodeRepository, hub: voiceNodeHub }));

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
