import { describe, it, expect, vi } from "vitest";
import { createZigbee2MqttGateway } from "./zigbee2mqtt-gateway.js";
import type { SharedMqttClient } from "./mqtt-client.js";

function makeClient() {
  const published: { topic: string; payload: string }[] = [];
  const handlers: ((topic: string, msg: Buffer) => void)[] = [];
  const client = {
    publish: vi.fn((topic: string, payload: string, cb: (err?: Error) => void) => {
      published.push({ topic, payload });
      cb();
    }),
    subscribe: vi.fn(),
    on: vi.fn((event: string, handler: (topic: string, msg: Buffer) => void) => {
      if (event === "message") handlers.push(handler);
    }),
    emit: (topic: string, payload: string) => handlers.forEach((h) => h(topic, Buffer.from(payload))),
  } as unknown as SharedMqttClient & { published: typeof published; emit: (t: string, p: string) => void };
  (client as any).published = published;
  (client as any).emit = (topic: string, payload: string) => handlers.forEach((h) => h(topic, Buffer.from(payload)));
  return client as unknown as SharedMqttClient & { published: typeof published; emit: (t: string, p: string) => void };
}

describe("Zigbee2MqttGateway", () => {
  it("publishes raw string payload wrapped in {state} to zigbee2mqtt/<topic>/set", async () => {
    const client = makeClient();
    const gateway = createZigbee2MqttGateway(client);

    await gateway.publish("living-room-light", "on");

    expect((client as any).published[0].topic).toBe("zigbee2mqtt/living-room-light/set");
    expect(JSON.parse((client as any).published[0].payload)).toEqual({ state: "on" });
  });

  it("passes already-valid JSON payload through without wrapping", async () => {
    const client = makeClient();
    const gateway = createZigbee2MqttGateway(client);

    await gateway.publish("device", '{"state":"ON","brightness":128}');

    expect((client as any).published[0].payload).toBe('{"state":"ON","brightness":128}');
  });

  it("subscribe listens on zigbee2mqtt/<topic> and calls handler on matching message", () => {
    const client = makeClient();
    const gateway = createZigbee2MqttGateway(client);
    const received: string[] = [];

    gateway.subscribe("my-sensor", (payload) => received.push(payload));
    (client as any).emit("zigbee2mqtt/my-sensor", '{"state":"ON"}');

    expect(received).toEqual(['{"state":"ON"}']);
  });

  it("subscribe does not call handler for unrelated topics", () => {
    const client = makeClient();
    const gateway = createZigbee2MqttGateway(client);
    const received: string[] = [];

    gateway.subscribe("my-sensor", (payload) => received.push(payload));
    (client as any).emit("zigbee2mqtt/other-sensor", "x");

    expect(received).toHaveLength(0);
  });
});
