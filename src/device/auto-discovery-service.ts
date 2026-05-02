import mqtt from "mqtt";
import type { AutoDiscoveryService, DeviceRepository } from "../ports.js";

const MQTT_URL = process.env.MQTT_URL ?? "";

export function createAutoDiscoveryService(
  deviceRepository: DeviceRepository
): AutoDiscoveryService {
  const unregisteredTopics = new Set<string>();
  let client: ReturnType<typeof mqtt.connect> | null = null;

  return {
    start() {
      if (!MQTT_URL || client) return;
      client = mqtt.connect(MQTT_URL);
      client.subscribe("#");
      client.on("message", async (topic) => {
        const devices = await deviceRepository.findAll();
        const known = devices.some((d) => d.topic === topic);
        if (!known) unregisteredTopics.add(topic);
      });
    },
    stop() {
      client?.end(true);
      client = null;
      unregisteredTopics.clear();
    },
    getUnregisteredTopics() {
      return [...unregisteredTopics];
    },
  };
}
