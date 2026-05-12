import { randomUUID } from "crypto";
import type {
  VoiceNode,
  VoiceNodeRepository,
  CastDiscovery,
  CastDeviceInfo,
  CastClientFactory,
  CastClient,
  AudioFileServer,
  TtsStreamOptions,
} from "../ports.js";

interface CastVoiceNodeHubDeps {
  repository: VoiceNodeRepository;
  discovery: CastDiscovery;
  clientFactory: CastClientFactory;
  audioFileServer: AudioFileServer;
}

export interface CastVoiceNodeHub {
  start(): void;
  stop(): void;
  sendTts(nodeId: string, audio: Buffer): Promise<void>;
  sendTtsStream(nodeId: string, chunks: AsyncIterable<Buffer>, opts?: TtsStreamOptions): Promise<string>;
  getNode(nodeId: string): VoiceNode | undefined;
  getConnectedNodes(): VoiceNode[];
  onNodeConfirmed(nodeId: string): void;
}

export function makeCastVoiceNodeHub({
  repository,
  discovery,
  clientFactory,
  audioFileServer,
}: CastVoiceNodeHubDeps): CastVoiceNodeHub {
  const connectedNodes = new Map<string, VoiceNode>();
  const clients = new Map<string, CastClient>();
  const connecting = new Map<string, Promise<CastClient | undefined>>();
  const pendingInfo = new Map<string, CastDeviceInfo>();

  function toVoiceNode(info: CastDeviceInfo): VoiceNode {
    return {
      id: info.uuid,
      label: info.name,
      location: "",
      capabilities: ["speaker"],
      confirmed: false,
      transport: "cast",
    };
  }

  function connectClient(info: CastDeviceInfo): void {
    const p = clientFactory.connect(info.host, info.port).then((client) => {
      clients.set(info.uuid, client);
      connecting.delete(info.uuid);
      return client;
    }).catch((err: Error) => {
      console.warn(`[CastHub] connect failed for ${info.uuid} (${info.host}): ${err.message}`);
      connecting.delete(info.uuid);
      return undefined;
    });
    connecting.set(info.uuid, p);
  }

  function handleFound(info: CastDeviceInfo): void {
    const node = toVoiceNode(info);
    connectedNodes.set(info.uuid, node);
    pendingInfo.set(info.uuid, info);
    repository.findById(info.uuid).then((existing) => {
      if (!existing) {
        repository.save(node);
      } else if (existing.confirmed) {
        pendingInfo.delete(info.uuid);
        connectClient(info);
      }
    }).catch((err: Error) => {
      console.warn(`[CastHub] repo error for ${info.uuid}: ${err.message}`);
    });
  }

  function handleLost(uuid: string): void {
    connectedNodes.delete(uuid);
    pendingInfo.delete(uuid);
    const client = clients.get(uuid);
    if (client) { client.close(); clients.delete(uuid); }
  }

  return {
    start() {
      discovery.onDeviceFound(handleFound);
      discovery.onDeviceLost(handleLost);
      discovery.start();
    },

    stop() {
      discovery.stop();
      for (const client of clients.values()) client.close();
      clients.clear();
      connectedNodes.clear();
      pendingInfo.clear();
    },

    onNodeConfirmed(nodeId) {
      const info = pendingInfo.get(nodeId);
      if (info) {
        pendingInfo.delete(nodeId);
        connectClient(info);
      }
    },

    async sendTts(nodeId, audio) {
      let client = clients.get(nodeId) ?? await connecting.get(nodeId);
      if (!client) {
        console.warn(`[CastHub] sendTts: node ${nodeId} not connected, dropping`);
        return;
      }
      const { url, cleanup } = await audioFileServer.serve(audio);
      await client.playUrl(url);
      setTimeout(cleanup, 30_000);
    },

    async sendTtsStream(nodeId, chunks, _opts) {
      // Cast nodes are speaker-only; AEC and sampleRate flags are ignored.
      const streamToken = randomUUID();
      let client = clients.get(nodeId) ?? await connecting.get(nodeId);
      if (!client) {
        console.warn(`[CastHub] sendTtsStream: node ${nodeId} not connected, dropping`);
        return streamToken;
      }
      const { url, cleanup } = await audioFileServer.serveStream(chunks);
      await client.playUrl(url);
      setTimeout(cleanup, 30_000);
      return streamToken;
    },

    getNode(nodeId) {
      return connectedNodes.get(nodeId);
    },

    getConnectedNodes() {
      return [...connectedNodes.values()];
    },
  };
}
