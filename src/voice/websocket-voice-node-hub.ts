import { WebSocketServer, WebSocket } from "ws";
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

type InboundMessage = RegisterMessage | UtteranceMessage | ConfigUpdatedMessage | { type: string };

export function makeWebSocketVoiceNodeHub(
  repository: VoiceNodeRepository,
  port: number,
): VoiceNodeHub {
  let wss: WebSocketServer | null = null;
  let utteranceHandler: ((nodeId: string, transcript: string) => void) | null = null;

  const connections = new Map<string, WebSocket>();
  const socketToNodeId = new Map<WebSocket, string>();
  const connectedNodes = new Map<string, VoiceNode>();

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
      ? { ...existing, label, location, capabilities }
      : { id, label, location, capabilities, confirmed: false };

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

    async sendTts(nodeId, audio) {
      const ws = connections.get(nodeId);
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        console.warn(`[VoiceNodeHub] sendTts: node ${nodeId} not connected, dropping response`);
        return;
      }
      ws.send(audio);
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
  };
}
