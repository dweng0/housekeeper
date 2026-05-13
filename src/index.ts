import express from "express";
import { join } from "path";
import { rm } from "fs/promises";
import { randomUUID } from "crypto";
import { jsonDeviceRepository } from "./device/json-device-repository.js";
import { jsonConfigRepository } from "./config/json-config-repository.js";
import { createZigbee2MqttDiscoveryService } from "./device/zigbee2mqtt-discovery-service.js";
import { makeJsonAutomationRepository } from "./automation/json-automation-repository.js";
import { makeAutomationRouter } from "./automation/automation-router.js";
import { makeAutomationEngine } from "./automation/automation-engine.js";
import { createMqttClient } from "./mqtt/mqtt-client.js";
import { createZigbee2MqttGateway } from "./mqtt/zigbee2mqtt-gateway.js";
import { makeWebSocketVoiceNodeHub } from "./voice/websocket-voice-node-hub.js";
import { makeCastVoiceNodeHub } from "./voice/cast-voice-node-hub.js";
import { makeCompositeVoiceNodeHub } from "./voice/composite-voice-node-hub.js";
import { makeBonjourCastDiscovery } from "./voice/bonjour-cast-discovery.js";
import { makeCastv2ClientFactory } from "./voice/castv2-cast-client-factory.js";
import { makeExpressAudioFileServer } from "./voice/express-audio-file-server.js";
import { makeJsonVoiceNodeRepository } from "./voice/json-voice-node-repository.js";
import { makeVoiceNodeRouter } from "./voice/voice-node-router.js";
import { makeTranscribeRouter } from "./voice/transcribe-router.js";
import { WhisperTranscriber } from "./voice/whisper-transcriber.js";
import { makeVoiceAutomationService } from "./voice/voice-automation-service.js";
import { makeOpenAIIntentClassifier } from "./voice/openai-intent-classifier.js";
import { makeOpenAiQueryResponder } from "./voice/openai-query-responder.js";
import { OpenAiTtsAdapter } from "./voice/openai-tts-adapter.js";
import { makeLogStore } from "./log-store.js";
import { makeResponseAudioCacheBuilder } from "./voice/response-audio-cache-builder.js";
import { makeJsonResponseAudioCache } from "./voice/json-response-audio-cache.js";
import { makeOpenAIResponseTextGenerator } from "./voice/openai-response-text-generator.js";
import { makeOpenAITtsRenderer } from "./voice/openai-tts-renderer.js";
import type { AppConfig, Device } from "./ports.js";

const app = express();
const port = Number(process.env.PORT ?? 3000);

app.use(express.json());

const appConfig = await jsonConfigRepository.get();
const mqttClient = createMqttClient(appConfig.mqttBrokerUrl ?? "mqtt://localhost:1883");
const mqttDeviceGateway = createZigbee2MqttGateway(mqttClient);
const discovery = createZigbee2MqttDiscoveryService(mqttClient);
discovery.onDeviceDiscovered(async (device) => {
  await jsonDeviceRepository.save(device);
});
discovery.onDeviceRemoved(async (topic) => {
  const all = await jsonDeviceRepository.findAll();
  const match = all.find((d) => d.topic === topic);
  if (match) await jsonDeviceRepository.delete(match.id);
});

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
const wsVoiceNodeHub = makeWebSocketVoiceNodeHub(voiceNodeRepository, voiceNodePort);

const castBaseUrl = process.env.CAST_BASE_URL ?? `http://localhost:${port}`;
const castVoiceNodeHub = makeCastVoiceNodeHub({
  repository: voiceNodeRepository,
  discovery: makeBonjourCastDiscovery(),
  clientFactory: makeCastv2ClientFactory(),
  audioFileServer: makeExpressAudioFileServer(app, castBaseUrl),
});

const voiceNodeHub = makeCompositeVoiceNodeHub(wsVoiceNodeHub, castVoiceNodeHub);

const classifier = makeOpenAIIntentClassifier({
  endpoint: process.env.LLM_ENDPOINT ?? "http://localhost:11434/v1",
  model: process.env.LLM_MODEL ?? "llama3.2",
  apiKey: process.env.LLM_API_KEY,
  devices: jsonDeviceRepository,
  config: jsonConfigRepository,
});

const speechOutput = new OpenAiTtsAdapter({
  endpoint: process.env.TTS_ENDPOINT ?? "http://localhost:8001",
  model: process.env.TTS_MODEL,
  voice: process.env.TTS_VOICE,
  apiKey: process.env.TTS_API_KEY,
  voiceNodeHub,
  config: jsonConfigRepository,
});

const queryResponder = makeOpenAiQueryResponder({
  endpoint: process.env.LLM_ENDPOINT ?? "http://localhost:11434/v1",
  model: process.env.LLM_MODEL ?? "llama3.2",
  apiKey: process.env.LLM_API_KEY,
});

const cacheDir = join(process.cwd(), "data", "response-cache");
const responseAudioCache = makeJsonResponseAudioCache(cacheDir);

const voiceService = makeVoiceAutomationService({
  voiceNodeHub,
  systemName: process.env.SYSTEM_NAME ?? "housekeeper",
  classifier,
  devices: jsonDeviceRepository,
  automations: automationRepository,
  speechOutput,
  queryResponder,
  gateway: mqttDeviceGateway,
  logStore,
  responseAudioCache,
  config: jsonConfigRepository,
});

voiceService.start();
discovery.start();

const ttsRenderer = makeOpenAITtsRenderer({
  endpoint: process.env.TTS_ENDPOINT ?? "http://localhost:8001",
  model: process.env.TTS_MODEL,
  voice: process.env.TTS_VOICE,
  apiKey: process.env.TTS_API_KEY,
});

const startupConfig = await jsonConfigRepository.get();
let cacheBuilder = makeResponseAudioCacheBuilder({
  textGenerator: makeOpenAIResponseTextGenerator({
    endpoint: process.env.LLM_ENDPOINT ?? "http://localhost:11434/v1",
    model: process.env.LLM_MODEL ?? "llama3.2",
    apiKey: process.env.LLM_API_KEY,
  }),
  ttsRenderer,
  cacheDir,
  variantCount: startupConfig.responseCacheVariantCount ?? 3,
});

console.log("[CacheBuilder] startup diff running…");
jsonDeviceRepository.findAll()
  .then((devices) => cacheBuilder.build(devices))
  .then(() => console.log("[CacheBuilder] startup diff complete"))
  .catch((err) => console.error("[CacheBuilder] startup error:", err));

app.post("/api/tts/speak", async (req, res) => {
  const { text, nodeId } = req.body as { text?: string; nodeId?: string };
  if (!text) { res.status(400).json({ error: "text required" }); return; }
  try {
    const config = await jsonConfigRepository.get();
    const targetId = nodeId ?? config.defaultOutputNodeId;
    if (!targetId) { res.status(400).json({ error: "no target node" }); return; }
    await speechOutput.speak(text, targetId);
    res.json({ ok: true, targetId });
  } catch (err) {
    console.error("[TTS] speak failed:", err);
    res.status(500).json({ error: String(err) });
  }
});

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
  const { defaultOutputNodeId, systemName, persona, responseCacheVariantCount, intentConfidenceThreshold, conversationFinishedThreshold } = req.body as Partial<AppConfig>;
  const updated: AppConfig = { ...current, defaultOutputNodeId, systemName, persona, responseCacheVariantCount, intentConfidenceThreshold, conversationFinishedThreshold };
  await jsonConfigRepository.save(updated);
  res.json(updated);
});

app.post("/api/voice/response-cache/rebuild", async (_req, res) => {
  res.status(202).json({ status: "rebuilding" });

  try {
    const cfg = await jsonConfigRepository.get();
    const variantCount = cfg.responseCacheVariantCount ?? 3;
    await rm(cacheDir, { recursive: true, force: true });
    const newBuilder = makeResponseAudioCacheBuilder({
      textGenerator: makeOpenAIResponseTextGenerator({
        endpoint: process.env.LLM_ENDPOINT ?? "http://localhost:11434/v1",
        model: process.env.LLM_MODEL ?? "llama3.2",
        apiKey: process.env.LLM_API_KEY,
      }),
      ttsRenderer,
      cacheDir,
      variantCount,
    });
    const devices = await jsonDeviceRepository.findAll();
    await newBuilder.build(devices);
    cacheBuilder = newBuilder;
    console.log("[CacheBuilder] full rebuild complete");
  } catch (err) {
    console.error("[CacheBuilder] rebuild error:", err);
  }
});

// --- Unregistered devices (auto-discovery) ---

// --- Automations ---

app.use("/api/automations", makeAutomationRouter({
  automations: automationRepository,
  devices: jsonDeviceRepository,
}));

// --- Voice Nodes ---

app.use("/api/voice-nodes", makeVoiceNodeRouter({ voiceNodes: voiceNodeRepository, hub: voiceNodeHub }));
app.use("/api/voice", makeTranscribeRouter({
  transcriber: new WhisperTranscriber(
    process.env.WHISPER_BIN ?? "whisper",
    process.env.WHISPER_MODEL ?? "base.en",
  ),
  hub: voiceNodeHub,
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
  cacheBuilder?.buildForDevice(device).catch((err) => console.error("[CacheBuilder] device add error:", err));
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
  cacheBuilder?.buildForDevice(device).catch((err) => console.error("[CacheBuilder] device update error:", err));
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
