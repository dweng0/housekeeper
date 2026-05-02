import mqtt from "mqtt";
import type { DeviceGateway } from "../ports.js";

const MQTT_URL = process.env.MQTT_URL ?? "";

function connect() {
  if (!MQTT_URL) return null;
  return mqtt.connect(MQTT_URL);
}

let client = connect();

export const mqttDeviceGateway: DeviceGateway = {
  async publish(topic, payload) {
    if (!client) return;
    await new Promise<void>((resolve, reject) =>
      client!.publish(topic, payload, (err) => (err ? reject(err) : resolve()))
    );
  },
  subscribe(topic, handler) {
    if (!client) return;
    client.subscribe(topic);
    client.on("message", (t, msg) => {
      if (t === topic || topic === "#") handler(msg.toString());
    });
  },
};

export function reconnectGateway() {
  client?.end(true);
  client = connect();
  return client;
}
