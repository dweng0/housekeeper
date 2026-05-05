import { randomUUID } from "crypto";
import type { AutoDiscoveryService, Device } from "../ports.js";
import type { SharedMqttClient } from "../mqtt/mqtt-client.js";

function inferType(exposes: unknown[]): "actuator" | "sensor" {
  function hasWritable(features: unknown[]): boolean {
    return features.some((f: any) => {
      if (typeof f.access === "number" && f.access & 2) return true;
      if (Array.isArray(f.features)) return hasWritable(f.features);
      return false;
    });
  }
  return hasWritable(exposes) ? "actuator" : "sensor";
}

export type Zigbee2MqttDiscoveryService = AutoDiscoveryService;

export function createZigbee2MqttDiscoveryService(client: SharedMqttClient): Zigbee2MqttDiscoveryService {
  const discoveredHandlers: ((device: Device) => void)[] = [];
  const removedHandlers: ((topic: string) => void)[] = [];

  client.on("message", (topic, msg) => {
    const payload = msg.toString();
    if (topic === "zigbee2mqtt/bridge/devices") {
      try {
        const devices: any[] = JSON.parse(payload);
        for (const d of devices) {
          const exposes: unknown[] = d.exposes ?? [];
          const device: Device = {
            id: randomUUID(),
            label: d.friendly_name,
            topic: d.friendly_name,
            type: inferType(exposes),
          };
          discoveredHandlers.forEach((h) => h(device));
        }
      } catch { /* malformed — ignore */ }
    } else if (topic === "zigbee2mqtt/bridge/event") {
      try {
        const event = JSON.parse(payload);
        if (event.type === "device_joined") {
          const exposes: unknown[] = event.data?.definition?.exposes ?? [];
          const device: Device = {
            id: randomUUID(),
            label: event.data.friendly_name,
            topic: event.data.friendly_name,
            type: inferType(exposes),
          };
          discoveredHandlers.forEach((h) => h(device));
        } else if (event.type === "device_left") {
          removedHandlers.forEach((h) => h(event.data.friendly_name));
        }
      } catch { /* malformed — ignore */ }
    }
  });

  return {
    start() {
      client.subscribe("zigbee2mqtt/bridge/devices");
      client.subscribe("zigbee2mqtt/bridge/event");
    },
    stop() {},
    onDeviceDiscovered(handler) {
      discoveredHandlers.push(handler);
    },
    onDeviceRemoved(handler) {
      removedHandlers.push(handler);
    },
  };
}
