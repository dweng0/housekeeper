import type { DeviceGateway } from "../ports.js";
import type { SharedMqttClient } from "./mqtt-client.js";

export function createZigbee2MqttGateway(client: SharedMqttClient): DeviceGateway {
  return {
    async publish(topic, payload) {
      const fullTopic = `zigbee2mqtt/${topic}/set`;
      let mqttPayload: string;
      try {
        JSON.parse(payload);
        mqttPayload = payload;
      } catch {
        mqttPayload = JSON.stringify({ state: payload });
      }
      await new Promise<void>((resolve, reject) =>
        client.publish(fullTopic, mqttPayload, (err) => (err ? reject(err) : resolve()))
      );
    },
    subscribe(topic, handler) {
      const fullTopic = `zigbee2mqtt/${topic}`;
      client.subscribe(fullTopic);
      client.on("message", (t, msg) => {
        if (t === fullTopic) handler(msg.toString());
      });
    },
  };
}
