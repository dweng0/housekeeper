import { describe, it, expect, vi } from "vitest";
import type { VoiceNode, VoiceNodeHub } from "../ports.js";
import { makeCompositeVoiceNodeHub } from "./composite-voice-node-hub.js";
import type { CastVoiceNodeHub } from "./cast-voice-node-hub.js";

function makeNode(id: string, transport: "websocket" | "cast"): VoiceNode {
  return { id, label: id, location: "test", capabilities: ["speaker"], confirmed: true, transport };
}

type StubHub = VoiceNodeHub & CastVoiceNodeHub & { sentTts: Array<{ nodeId: string; audio: Buffer }> };

function makeStubHub(nodes: VoiceNode[]): StubHub {
  const sentTts: Array<{ nodeId: string; audio: Buffer }> = [];
  return {
    start: vi.fn(),
    stop: vi.fn(),
    onUtterance: vi.fn(),
    pushUtterance: vi.fn(),
    sendConfig: vi.fn(),
    onNodeConfirmed: vi.fn(),
    sendTts: async (nodeId, audio) => { sentTts.push({ nodeId, audio }); },
    getNode: (id) => nodes.find((n) => n.id === id),
    getConnectedNodes: () => nodes,
    sentTts,
  };
}

const WS_NODE = makeNode("ws-1", "websocket");
const CAST_NODE = makeNode("cast-1", "cast");
const AUDIO = Buffer.from([0xca, 0xfe]);

describe("CompositeVoiceNodeHub", () => {
  it("routes sendTts to WS hub for websocket nodes", async () => {
    const wsHub = makeStubHub([WS_NODE]);
    const castHub = makeStubHub([CAST_NODE]);
    const hub = makeCompositeVoiceNodeHub(wsHub, castHub);

    await hub.sendTts("ws-1", AUDIO);

    expect(wsHub.sentTts).toHaveLength(1);
    expect(wsHub.sentTts[0]).toEqual({ nodeId: "ws-1", audio: AUDIO });
    expect(castHub.sentTts).toHaveLength(0);
  });

  it("routes sendTts to Cast hub for cast nodes", async () => {
    const wsHub = makeStubHub([WS_NODE]);
    const castHub = makeStubHub([CAST_NODE]);
    const hub = makeCompositeVoiceNodeHub(wsHub, castHub);

    await hub.sendTts("cast-1", AUDIO);

    expect(castHub.sentTts).toHaveLength(1);
    expect(castHub.sentTts[0]).toEqual({ nodeId: "cast-1", audio: AUDIO });
    expect(wsHub.sentTts).toHaveLength(0);
  });

  it("getConnectedNodes returns union of both hubs", () => {
    const hub = makeCompositeVoiceNodeHub(makeStubHub([WS_NODE]), makeStubHub([CAST_NODE]));
    const ids = hub.getConnectedNodes().map((n) => n.id);
    expect(ids).toContain("ws-1");
    expect(ids).toContain("cast-1");
    expect(ids).toHaveLength(2);
  });

  it("getNode finds nodes across both hubs", () => {
    const hub = makeCompositeVoiceNodeHub(makeStubHub([WS_NODE]), makeStubHub([CAST_NODE]));
    expect(hub.getNode("ws-1")?.id).toBe("ws-1");
    expect(hub.getNode("cast-1")?.id).toBe("cast-1");
    expect(hub.getNode("missing")).toBeUndefined();
  });
});
