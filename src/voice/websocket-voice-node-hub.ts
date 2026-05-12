import { WebSocketServer, WebSocket } from "ws";
import { randomUUID } from "crypto";
import type { VoiceNode, VoiceNodeHub, VoiceNodeConfigPatch, VoiceNodeRepository } from "../ports.js";

interface RegisterMessage {
  type: "register";
  id: string;
  label: string;
  location: string;
  capabilities: ("mic" | "speaker")[];
}

interface UtteranceMessage {
  type: "utterance";
  text: string;
}

interface ConfigUpdatedMessage {
  type: "config_updated";
  success: boolean;
  error?: string;
}

interface StopWordMessage {
  type: "stop_word";
  keyword: string;
}

interface TtsStreamCompleteMessage {
  type: "tts_stream_complete";
  streamToken: string;
}

type InboundMessage = RegisterMessage | UtteranceMessage | ConfigUpdatedMessage | StopWordMessage | TtsStreamCompleteMessage | { type: string };

interface StreamCacheEntry {
  chunks: Buffer[];
  expireAt: number;
}

export function makeWebSocketVoiceNodeHub(
  repository: VoiceNodeRepository,
  port: number,
): VoiceNodeHub {
  let wss: WebSocketServer | null = null;
  let utteranceHandler: ((nodeId: string, transcript: string) => void) | null = null;
  let stopWordHandler: ((nodeId: string, keyword: string) => void) | null = null;
  let ttsStreamCompleteHandler: ((nodeId: string, streamToken: string) => void) | null = null;

  const connections = new Map<string, WebSocket>();
  const socketToNodeId = new Map<WebSocket, string>();
  const connectedNodes = new Map<string, VoiceNode>();
  const streamCache = new Map<string, StreamCacheEntry>();
  const TTL_MS = 30000; // 30 seconds

  function pruneExpiredCache(): void {
    const now = Date.now();
    for (const [key, entry] of streamCache.entries()) {
      if (now > entry.expireAt) {
        streamCache.delete(key);
      }
    }
  }

  function sendJson(ws: WebSocket, msg: object): void {
    ws.send(JSON.stringify(msg));
  }

  function sendError(ws: WebSocket, code: string, message: string): void {
    sendJson(ws, { type: "error", code, message });
  }

  async function handleRegister(ws: WebSocket, msg: RegisterMessage): Promise<void> {
    const { id, label, location, capabilities } = msg;

    if (!id || !label || !location || !Array.isArray(capabilities)) {
      sendError(ws, "INVALID_MESSAGE", "register requires id, label, location, capabilities");
      return;
    }

    const existing = await repository.findById(id);
    const isNew = existing === null;

    const node: VoiceNode = existing
      ? { ...existing, label, location, capabilities, transport: "websocket" }
      : { id, label, location, capabilities, confirmed: false, transport: "websocket" };

    await repository.save(node);

    connections.set(id, ws);
    socketToNodeId.set(ws, id);
    connectedNodes.set(id, node);

    sendJson(ws, { type: "registered", id, status: isNew ? "new" : "reconnected" });
    console.log(`[VoiceNodeHub] ${isNew ? "New" : "Reconnected"} node: ${label} @ ${location} (${id})`);
  }

  function handleUtterance(ws: WebSocket, msg: UtteranceMessage): void {
    const nodeId = socketToNodeId.get(ws);
    if (!nodeId) {
      sendError(ws, "REGISTRATION_REQUIRED", "send register before utterance");
      return;
    }
    if (!msg.text || typeof msg.text !== "string") {
      sendError(ws, "INVALID_MESSAGE", "utterance requires non-empty text");
      return;
    }
    utteranceHandler?.(nodeId, msg.text);
  }

  function handleMessage(ws: WebSocket, raw: string): void {
    let msg: InboundMessage;
    try {
      msg = JSON.parse(raw) as InboundMessage;
    } catch {
      sendError(ws, "INVALID_MESSAGE", "expected JSON");
      return;
    }

    if (msg.type === "register") {
      handleRegister(ws, msg as RegisterMessage);
    } else if (msg.type === "utterance") {
      handleUtterance(ws, msg as UtteranceMessage);
    } else if (msg.type === "config_updated") {
      const ack = msg as ConfigUpdatedMessage;
      if (!ack.success) console.warn(`[VoiceNodeHub] config_updated failed: ${ack.error}`);
    } else if (msg.type === "stop_word") {
      const nodeId = socketToNodeId.get(ws);
      if (!nodeId) {
        sendError(ws, "REGISTRATION_REQUIRED", "send register before stop_word");
        return;
      }
      const swMsg = msg as StopWordMessage;
      if (!swMsg.keyword || typeof swMsg.keyword !== "string") {
        sendError(ws, "INVALID_MESSAGE", "stop_word requires keyword");
        return;
      }
      stopWordHandler?.(nodeId, swMsg.keyword);
    } else if (msg.type === "tts_stream_complete") {
      const nodeId = socketToNodeId.get(ws);
      if (!nodeId) {
        sendError(ws, "REGISTRATION_REQUIRED", "send register before tts_stream_complete");
        return;
      }
      const tsMsg = msg as TtsStreamCompleteMessage;
      if (!tsMsg.streamToken || typeof tsMsg.streamToken !== "string") {
        sendError(ws, "INVALID_MESSAGE", "tts_stream_complete requires streamToken");
        return;
      }
      ttsStreamCompleteHandler?.(nodeId, tsMsg.streamToken);
    } else {
      sendError(ws, "INVALID_MESSAGE", `unknown message type: ${msg.type}`);
    }
  }

  return {
    start() {
      wss = new WebSocketServer({ port });
      console.log(`[VoiceNodeHub] Listening on ws port ${port}`);

      wss.on("connection", (ws) => {
        const timeout = setTimeout(() => {
          if (!socketToNodeId.has(ws)) {
            ws.close(4000, "registration timeout");
          }
        }, 5000);

        ws.on("message", (data, isBinary) => {
          if (isBinary) return;
          clearTimeout(timeout);
          handleMessage(ws, data.toString());
        });

        ws.on("close", () => {
          clearTimeout(timeout);
          const nodeId = socketToNodeId.get(ws);
          if (nodeId) {
            connections.delete(nodeId);
            socketToNodeId.delete(ws);
            connectedNodes.delete(nodeId);
            console.log(`[VoiceNodeHub] Node disconnected: ${nodeId}`);
          }
        });
      });
    },

    stop() {
      wss?.close();
      wss = null;
      connections.clear();
      socketToNodeId.clear();
      connectedNodes.clear();
    },

    onUtterance(handler) {
      utteranceHandler = handler;
    },

    onStopWord(handler) {
      stopWordHandler = handler;
    },

    onTtsStreamComplete(handler) {
      ttsStreamCompleteHandler = handler;
    },

    async sendTts(nodeId, audio) {
      async function* singleChunk() {
        yield audio;
      }
      await this.sendTtsStream(nodeId, singleChunk());
    },

    async sendTtsStream(nodeId, chunks, opts) {
      const ws = connections.get(nodeId);
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        console.warn(`[VoiceNodeHub] sendTtsStream: node ${nodeId} not connected, dropping response`);
        return randomUUID();
      }
      const streamToken = randomUUID();
      const cacheKey = `${nodeId}:${streamToken}`;
      const bufferedChunks: Buffer[] = [];
      const sampleRate = opts?.sampleRate ?? 24000;
      const useForAec = opts?.useForAec ?? true;

      console.log(`[VoiceNodeHub] sendTtsStream: starting stream to ${nodeId}`);
      sendJson(ws, { type: "tts_stream_start", streamToken, sampleRate, useForAec });
      for await (const chunk of chunks) {
        if (ws.readyState !== WebSocket.OPEN) break;
        bufferedChunks.push(chunk);
        ws.send(chunk);
      }
      sendJson(ws, { type: "tts_stream_end" });

      // Prune expired entries before storing (quiet auto-cleanup)
      pruneExpiredCache();

      // Store in cache with TTL
      streamCache.set(cacheKey, {
        chunks: bufferedChunks,
        expireAt: Date.now() + TTL_MS,
      });

      return streamToken;
    },

    async sendConfig(nodeId, patch: VoiceNodeConfigPatch) {
      const ws = connections.get(nodeId);
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      const msg: Record<string, unknown> = { type: "config_update" };
      if (patch.label !== undefined) msg.label = patch.label;
      if (patch.location !== undefined) msg.location = patch.location;
      if (patch.devices !== undefined) msg.devices = patch.devices;
      sendJson(ws, msg);
    },

    getNode(nodeId) {
      return connectedNodes.get(nodeId);
    },

    getConnectedNodes() {
      return [...connectedNodes.values()];
    },

    pushUtterance(nodeId, transcript) {
      utteranceHandler?.(nodeId, transcript);
    },

    getStreamBuffer(nodeId, token) {
      const cacheKey = `${nodeId}:${token}`;
      const entry = streamCache.get(cacheKey);
      if (!entry) return null;
      if (Date.now() > entry.expireAt) {
        streamCache.delete(cacheKey);
        return null;
      }
      return entry.chunks;
    },
  };
}
