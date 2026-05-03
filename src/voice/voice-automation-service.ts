import { randomUUID } from "crypto";
import type {
  AutomationRepository,
  DeviceRepository,
  IntentClassifier,
  VoiceNodeHub,
  SpeechOutput,
} from "../ports.js";
import { makeListeningWindow } from "./listening-window.js";
import type { ListeningWindow } from "./listening-window.js";
import type { LogStore, DirectedQuestionOutcome } from "../log-store.js";

interface VoiceAutomationServiceDeps {
  voiceNodeHub: VoiceNodeHub;
  systemName: string;
  classifier: IntentClassifier;
  devices: DeviceRepository;
  automations: AutomationRepository;
  speechOutput: SpeechOutput;
  logStore?: LogStore;
}

export interface VoiceAutomationService {
  start(): void;
  stop(): void;
}

export function makeVoiceAutomationService({
  voiceNodeHub,
  systemName,
  classifier,
  devices,
  automations,
  speechOutput,
  logStore,
}: VoiceAutomationServiceDeps): VoiceAutomationService {
  const windows = new Map<string, ListeningWindow>();

  function getWindow(nodeId: string): ListeningWindow {
    if (!windows.has(nodeId)) {
      windows.set(nodeId, makeListeningWindow({
        systemName,
        onDirectedQuestion: async (transcript) => {
          let intent = { type: "unknown" } as import("../ports.js").ClassifiedIntent;
          let outcome: DirectedQuestionOutcome = "unknown-intent";

          try {
            intent = await classifier.classify(transcript);

            if (intent.type !== "create-automation" || !intent.automation) {
              outcome = "unknown-intent";
            } else {
              const { trigger, actions, enabled } = intent.automation;

              const triggerDevice = await devices.findByLabel(trigger.deviceLabel);
              if (!triggerDevice) {
                await speechOutput.speak(`I don't know a device called ${trigger.deviceLabel}`, nodeId);
                outcome = "unknown-device";
              } else {
                let unknownAction: string | null = null;
                for (const action of actions) {
                  if (!(await devices.findByLabel(action.deviceLabel))) {
                    unknownAction = action.deviceLabel;
                    break;
                  }
                }

                if (unknownAction) {
                  await speechOutput.speak(`I don't know a device called ${unknownAction}`, nodeId);
                  outcome = "unknown-device";
                } else {
                  const existing = await automations.findAll();
                  const duplicate = existing.find(
                    (a) =>
                      a.trigger.deviceLabel === trigger.deviceLabel &&
                      a.trigger.event === trigger.event &&
                      a.actions[0]?.deviceLabel === actions[0]?.deviceLabel,
                  );

                  if (duplicate) {
                    await speechOutput.speak("There's already an automation for that", nodeId);
                    outcome = "duplicate-automation";
                  } else {
                    await automations.save({ id: randomUUID(), enabled, trigger, actions });
                    outcome = "automation-created";
                  }
                }
              }
            }
          } catch (err) {
            console.error("[VoiceAutomation] error:", err instanceof Error ? err.message : err);
            outcome = "error";
          } finally {
            logStore?.append({
              type: "directed-question",
              timestamp: new Date().toISOString(),
              nodeId,
              transcript,
              intent,
              outcome,
            });
          }
        },
      }));
    }
    return windows.get(nodeId)!;
  }

  return {
    start() {
      voiceNodeHub.onUtterance((nodeId, text) => {
        console.log(`[Heard] [${nodeId}]`, text);
        getWindow(nodeId).addUtterance(text);
      });
      voiceNodeHub.start();
    },
    stop() {
      voiceNodeHub.stop();
      windows.clear();
    },
  };
}
