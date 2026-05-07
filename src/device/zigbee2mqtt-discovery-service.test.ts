import { describe, it, expect, vi } from "vitest";
import { createZigbee2MqttDiscoveryService } from "./zigbee2mqtt-discovery-service.js";
import type { SharedMqttClient } from "../mqtt/mqtt-client.js";

function makeClient() {
  const handlers: Map<string, ((topic: string, msg: Buffer) => void)[]> = new Map();
  const subscribed: string[] = [];
  const client = {
    subscribe: vi.fn((topic: string) => subscribed.push(topic)),
    on: vi.fn((event: string, handler: (topic: string, msg: Buffer) => void) => {
      if (!handlers.has(event)) handlers.set(event, []);
      handlers.get(event)!.push(handler);
    }),
  } as unknown as SharedMqttClient;
  const emit = (topic: string, payload: string) =>
    handlers.get("message")?.forEach((h) => h(topic, Buffer.from(payload)));
  return { client, subscribed, emit };
}

describe("Zigbee2MqttDiscoveryService", () => {
  it("fires onDeviceDiscovered for each device in bridge/devices message", async () => {
    const { client, emit } = makeClient();
    const service = createZigbee2MqttDiscoveryService(client);
    const discovered: import("../ports.js").Device[] = [];
    service.onDeviceDiscovered((d) => discovered.push(d));
    service.start();

    emit("zigbee2mqtt/bridge/devices", JSON.stringify([
      { friendly_name: "kitchen-light", exposes: [{ access: 2, name: "state" }] },
      { friendly_name: "temp-sensor", exposes: [{ access: 1, name: "temperature" }] },
    ]));

    await vi.waitFor(() => expect(discovered).toHaveLength(2));
    expect(discovered[0].label).toBe("kitchen-light");
    expect(discovered[0].topic).toBe("kitchen-light");
    expect(discovered[0].type).toBe("actuator");
    expect(discovered[1].type).toBe("sensor");
  });

  it("fires onDeviceDiscovered on device_joined bridge event", async () => {
    const { client, emit } = makeClient();
    const service = createZigbee2MqttDiscoveryService(client);
    const discovered: import("../ports.js").Device[] = [];
    service.onDeviceDiscovered((d) => discovered.push(d));
    service.start();

    emit("zigbee2mqtt/bridge/event", JSON.stringify({
      type: "device_joined",
      data: { friendly_name: "new-plug", definition: { exposes: [{ access: 2, name: "state" }] } },
    }));

    await vi.waitFor(() => expect(discovered).toHaveLength(1));
    expect(discovered[0].label).toBe("new-plug");
    expect(discovered[0].type).toBe("actuator");
  });

  it("fires onDeviceRemoved on device_left bridge event", async () => {
    const { client, emit } = makeClient();
    const service = createZigbee2MqttDiscoveryService(client);
    const removed: string[] = [];
    service.onDeviceRemoved((topic) => removed.push(topic));
    service.start();

    emit("zigbee2mqtt/bridge/event", JSON.stringify({
      type: "device_left",
      data: { friendly_name: "old-sensor" },
    }));

    await vi.waitFor(() => expect(removed).toHaveLength(1));
    expect(removed[0]).toBe("old-sensor");
  });

  it("populates commandMap from binary exposes on bridge/devices", async () => {
    const { client, emit } = makeClient();
    const service = createZigbee2MqttDiscoveryService(client);
    const discovered: import("../ports.js").Device[] = [];
    service.onDeviceDiscovered((d) => discovered.push(d));
    service.start();

    emit("zigbee2mqtt/bridge/devices", JSON.stringify([
      {
        friendly_name: "porch-light",
        exposes: [{
          type: "binary",
          name: "state",
          value_on: "ON",
          value_off: "OFF",
          value_toggle: "TOGGLE",
          access: 7,
        }],
      },
    ]));

    await vi.waitFor(() => expect(discovered).toHaveLength(1));
    expect(discovered[0].commandMap).toEqual({ on: "ON", off: "OFF", toggle: "TOGGLE" });
  });

  it("populates commandMap from nested features (composite exposes)", async () => {
    const { client, emit } = makeClient();
    const service = createZigbee2MqttDiscoveryService(client);
    const discovered: import("../ports.js").Device[] = [];
    service.onDeviceDiscovered((d) => discovered.push(d));
    service.start();

    emit("zigbee2mqtt/bridge/devices", JSON.stringify([
      {
        friendly_name: "smart-light",
        exposes: [{
          type: "light",
          features: [
            { type: "binary", name: "state", value_on: "ON", value_off: "OFF", value_toggle: "TOGGLE", access: 7 },
            { type: "numeric", name: "brightness", value_min: 0, value_max: 254, access: 7 },
          ],
        }],
      },
    ]));

    await vi.waitFor(() => expect(discovered).toHaveLength(1));
    expect(discovered[0].commandMap).toEqual({ on: "ON", off: "OFF", toggle: "TOGGLE" });
  });

  it("subscribes to bridge/devices and bridge/event on start", () => {
    const { client, subscribed } = makeClient();
    const service = createZigbee2MqttDiscoveryService(client);
    service.start();
    expect(subscribed).toContain("zigbee2mqtt/bridge/devices");
    expect(subscribed).toContain("zigbee2mqtt/bridge/event");
  });
});
