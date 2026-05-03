import type { AutomationRepository, DeviceGateway, DeviceRepository } from "../ports.js";
import type { LogStore } from "../log-store.js";

interface EngineDeps {
  devices: DeviceRepository;
  automations: AutomationRepository;
  gateway: DeviceGateway;
  logStore?: LogStore;
}

export interface AutomationEngine {
  start(): Promise<void>;
  stop(): void;
}

export function makeAutomationEngine({ devices, automations, gateway, logStore }: EngineDeps): AutomationEngine {
  return {
    async start() {
      const allDevices = await devices.findAll();
      const sensors = allDevices.filter((d) => d.type === "sensor");

      for (const sensor of sensors) {
        gateway.subscribe(sensor.topic, async (payload) => {
          const allAutomations = await automations.findAll();
          const allDevicesList = await devices.findAll();

          for (const automation of allAutomations) {
            if (!automation.enabled) continue;
            if (automation.trigger.deviceLabel !== sensor.label) continue;
            if (automation.trigger.event !== payload) continue;

            const firedActions: { topic: string; command: string }[] = [];
            for (const action of automation.actions) {
              const actuator = allDevicesList.find((d) => d.label === action.deviceLabel);
              if (!actuator) continue;

              await gateway.publish(actuator.topic, action.command);
              firedActions.push({ topic: actuator.topic, command: action.command });

              if (action.durationSeconds && action.reverseCommand) {
                setTimeout(async () => {
                  await gateway.publish(actuator.topic, action.reverseCommand!);
                }, action.durationSeconds * 1000);
              }
            }

            logStore?.append({
              type: "automation-firing",
              timestamp: new Date().toISOString(),
              automationId: automation.id,
              triggerTopic: sensor.topic,
              triggerPayload: payload,
              actions: firedActions,
            });
          }
        });
      }
    },

    stop() {},
  };
}
