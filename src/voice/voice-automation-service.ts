import { randomUUID } from "crypto";
import type {
  AutomationRepository,
  DeviceRepository,
  IntentClassifier,
  SpeechInput,
  SpeechOutput,
} from "../ports.js";
import { makeListeningWindow } from "./listening-window.js";

interface VoiceAutomationServiceDeps {
  speechInput: SpeechInput;
  systemName: string;
  classifier: IntentClassifier;
  devices: DeviceRepository;
  automations: AutomationRepository;
  speechOutput: SpeechOutput;
}

export interface VoiceAutomationService {
  start(): void;
  stop(): void;
}

export function makeVoiceAutomationService({
  speechInput,
  systemName,
  classifier,
  devices,
  automations,
  speechOutput,
}: VoiceAutomationServiceDeps): VoiceAutomationService {
  const window = makeListeningWindow({
    systemName,
    onDirectedQuestion: async (transcript) => {
      const intent = await classifier.classify(transcript);

      if (intent.type !== "create-automation" || !intent.automation) return;

      const { trigger, actions, enabled } = intent.automation;

      const triggerDevice = await devices.findByLabel(trigger.deviceLabel);
      if (!triggerDevice) {
        await speechOutput.speak(`I don't know a device called ${trigger.deviceLabel}`);
        return;
      }

      for (const action of actions) {
        const actionDevice = await devices.findByLabel(action.deviceLabel);
        if (!actionDevice) {
          await speechOutput.speak(`I don't know a device called ${action.deviceLabel}`);
          return;
        }
      }

      await automations.save({ id: randomUUID(), enabled, trigger, actions });
    },
  });

  return {
    start() {
      speechInput.onUtterance((text) => window.addUtterance(text));
      speechInput.startListening();
    },
    stop() {
      speechInput.stopListening();
    },
  };
}
