import type { VoiceNode, VoiceNodeHub, VoiceNodeConfigPatch } from "../ports.js";
import type { CastVoiceNodeHub } from "./cast-voice-node-hub.js";

export function makeCompositeVoiceNodeHub(
  wsHub: VoiceNodeHub,
  castHub: CastVoiceNodeHub,
): VoiceNodeHub {
  function resolveHub(nodeId: string): VoiceNodeHub | CastVoiceNodeHub {
    return castHub.getNode(nodeId) ? castHub : wsHub;
  }

  return {
    start() {
      wsHub.start();
      castHub.start();
    },

    stop() {
      wsHub.stop();
      castHub.stop();
    },

    onUtterance(handler) {
      wsHub.onUtterance(handler);
    },

    pushUtterance(nodeId, transcript) {
      wsHub.pushUtterance(nodeId, transcript);
    },

    async sendTts(nodeId, audio) {
      await resolveHub(nodeId).sendTts(nodeId, audio);
    },

    async sendTtsStream(nodeId, chunks, opts) {
      return await resolveHub(nodeId).sendTtsStream(nodeId, chunks, opts);
    },

    async sendConfig(nodeId, patch: VoiceNodeConfigPatch) {
      await wsHub.sendConfig(nodeId, patch);
    },

    getNode(nodeId): VoiceNode | undefined {
      return wsHub.getNode(nodeId) ?? castHub.getNode(nodeId);
    },

    getConnectedNodes(): VoiceNode[] {
      return [...wsHub.getConnectedNodes(), ...castHub.getConnectedNodes()];
    },

    onNodeConfirmed(nodeId: string): void {
      castHub.onNodeConfirmed(nodeId);
    },

    getStreamBuffer(nodeId, token) {
      return wsHub.getStreamBuffer(nodeId, token);
    },
  };
}
