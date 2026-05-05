import mqtt from "mqtt";

export function createMqttClient(brokerUrl: string) {
  return mqtt.connect(brokerUrl);
}

export type SharedMqttClient = ReturnType<typeof createMqttClient>;
