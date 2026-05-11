import { randomUUID } from "crypto";
import type {
  AutomationRepository,
  ConfigRepository,
  DeviceGateway,
  DeviceRepository,
  IntentClassifier,
  MemoryStore,
  QueryResponder,
  ResponseAudioCache,
  VoiceNodeHub,
  SpeechOutput,
} from "../ports.js";
import { nullResponseAudioCache } from "./null-response-audio-cache.js";
import type { ResidentSession } from "../memory/resident-session.js";
import { makeListeningWindow } from "./listening-window.js";
import type { ListeningWindow } from "./listening-window.js";
import type { LogStore, DirectedQuestionOutcome } from "../log-store.js";
import { makeConversationContext } from "./conversation-context.js";
import type { ConversationContext } from "./conversation-context.js";

const DEFAULT_HISTORY_TOKEN_BUDGET = 4_000;

interface VoiceAutomationServiceDeps {
  voiceNodeHub: VoiceNodeHub;
  systemName: string;
  classifier: IntentClassifier;
  devices: DeviceRepository;
  automations: AutomationRepository;
  speechOutput: SpeechOutput;
  queryResponder?: QueryResponder;
  gateway?: DeviceGateway;
  logStore?: LogStore;
  session?: ResidentSession;
  memoryStore?: MemoryStore;
  responseAudioCache?: ResponseAudioCache;
  config?: ConfigRepository;
}

export interface VoiceAutomationService {
  start(): void;
  stop(): void;
}

function toSpeakableLength(text: string, maxSentences = 2): string {
  const sentences = text.match(/[^.!?]+[.!?]+/g) ?? [text];
  return sentences.slice(0, maxSentences).join(" ").trim();
}

const DEFAULT_CONFIDENCE_THRESHOLD = 0.7;

export function makeVoiceAutomationService({
  voiceNodeHub,
  systemName,
  classifier,
  devices,
  automations,
  speechOutput,
  queryResponder,
  gateway,
  logStore,
  session,
  memoryStore,
  responseAudioCache = nullResponseAudioCache,
  config,
}: VoiceAutomationServiceDeps): VoiceAutomationService {
  const windows = new Map<string, ListeningWindow>();
  const contexts = new Map<string, ConversationContext>();

  function getContext(nodeId: string): ConversationContext {
    if (!contexts.has(nodeId)) {
      contexts.set(nodeId, makeConversationContext());
    }
    return contexts.get(nodeId)!;
  }

  function getWindow(nodeId: string): ListeningWindow {
    if (!windows.has(nodeId)) {
      windows.set(nodeId, makeListeningWindow({
        systemName,
        onAmbientUtterance: async (text) => {
          const ctx = getContext(nodeId);
          if (!ctx.isOpen()) return;

          const cfg = config ? await config.get() : null;
          const threshold = cfg?.intentConfidenceThreshold ?? DEFAULT_CONFIDENCE_THRESHOLD;
          const historyTokenBudget = cfg?.historyTokenBudget ?? DEFAULT_HISTORY_TOKEN_BUDGET;

          const history = ctx.getHistory(historyTokenBudget);
          const residentId = session?.getResidentId();
          const memories = memoryStore && residentId
            ? await memoryStore.search(residentId, text)
            : [];
          const originatingNode = voiceNodeHub.getNode(nodeId);
          const intent = await classifier.classify({
            utterance: text,
            residentId,
            memories,
            location: originatingNode?.location,
            conversationHistory: history,
          });

          const isLowConfidence = intent.intentConfidence !== undefined && intent.intentConfidence < threshold;
          let spokenResponse: string | undefined;

          try {
            // Determine what to speak: clarifyingQuestion on low confidence, otherwise response
            if (isLowConfidence && intent.clarifyingQuestion) {
              spokenResponse = intent.clarifyingQuestion;
              await speechOutput.speak(spokenResponse, nodeId);
            } else if (intent.type === "query") {
              const spoken = intent.spokenResponse ?? intent.response;
              if (spoken) {
                await speechOutput.speak(spoken, nodeId);
                spokenResponse = spoken;
              } else if (queryResponder && intent.query) {
                const reply = await queryResponder.respond(intent.query, {
                  residentId,
                  memories,
                  location: originatingNode?.location,
                });
                await speechOutput.speak(reply, nodeId);
                spokenResponse = reply;
              }
            } else if (intent.type === "set-resident") {
              const spoken = intent.spokenResponse ?? intent.response;
              if (spoken) {
                await speechOutput.speak(spoken, nodeId);
                spokenResponse = spoken;
              }
              ctx.reset();
            } else if (intent.type === "device-control" && !isLowConfidence) {
              const spoken = intent.spokenResponse ?? intent.response;
              if (intent.deviceLabel && intent.command) {
                const device = await devices.findByLabel(intent.deviceLabel);
                if (device) {
                  const resolvedCommand = device.commandMap?.[intent.command] ?? intent.command;
                  await gateway?.publish(device.topic, resolvedCommand);
                  if (spoken) {
                    const cached = await responseAudioCache.lookup({ deviceLabel: intent.deviceLabel, command: intent.command });
                    if (cached) {
                      await voiceNodeHub.sendTts(nodeId, cached);
                    } else {
                      await speechOutput.speak(spoken, nodeId);
                    }
                    spokenResponse = spoken;
                  }
                } else if (spoken) {
                  await speechOutput.speak(`I don't know a device called ${intent.deviceLabel}`, nodeId);
                }
              }
            } else if (intent.type === "create-automation" && !isLowConfidence && intent.automation) {
              const { trigger, actions, enabled } = intent.automation;
              const triggerDevice = await devices.findByLabel(trigger.deviceLabel);
              if (triggerDevice) {
                let unknownAction: string | null = null;
                for (const action of actions) {
                  if (!(await devices.findByLabel(action.deviceLabel))) {
                    unknownAction = action.deviceLabel;
                    break;
                  }
                }
                if (!unknownAction) {
                  const existing = await automations.findAll();
                  const duplicate = existing.find(
                    (a) =>
                      a.trigger.deviceLabel === trigger.deviceLabel &&
                      a.trigger.event === trigger.event &&
                      a.actions[0]?.deviceLabel === actions[0]?.deviceLabel,
                  );
                  if (!duplicate) {
                    await automations.save({ id: randomUUID(), enabled, trigger, actions });
                    const spoken = intent.spokenResponse ?? intent.response;
                    if (spoken) {
                      await speechOutput.speak(spoken, nodeId);
                      spokenResponse = spoken;
                    }
                    if (memoryStore && residentId) {
                      const fact = `When ${trigger.deviceLabel} ${trigger.event}, ${actions.map((a) => `${a.command} ${a.deviceLabel}`).join(" and ")}`;
                      await memoryStore.store(residentId, fact);
                    }
                  }
                }
              }
            }
          } catch (err) {
            console.error("[VoiceAutomation] ambient utterance error:", err instanceof Error ? err.message : err);
          } finally {
            // Always add turn to context, even for unknown or clarifications
            ctx.addTurn(text, spokenResponse ?? "");
          }
        },
        onDirectedQuestion: async (transcript) => {
          const cfg = config ? await config.get() : null;
          const threshold = cfg?.intentConfidenceThreshold ?? DEFAULT_CONFIDENCE_THRESHOLD;
          getContext(nodeId).reset();
          let intent = { type: "unknown" } as import("../ports.js").ClassifiedIntent;
          let outcome: DirectedQuestionOutcome = "unknown-intent";
          let respondedText: string | undefined;

          try {
            const residentId = session?.getResidentId();
            const memories = memoryStore && residentId
              ? await memoryStore.search(residentId, transcript)
              : [];
            const originatingNode = voiceNodeHub.getNode(nodeId);
            intent = await classifier.classify({
              utterance: transcript,
              residentId,
              memories,
              location: originatingNode?.location,
            });
            const isLowConfidence = intent.intentConfidence !== undefined && intent.intentConfidence < threshold;
            const activeResponse = isLowConfidence ? (intent.clarifyingQuestion ?? intent.response) : intent.response;

            if (activeResponse) {
              intent = { ...intent, spokenResponse: toSpeakableLength(activeResponse) };
            }
            console.log("[VoiceAutomation] Classified intent:", JSON.stringify(intent));

            if (intent.residentName) {
              session?.setActive(intent.residentName);
            }

            const spoken = intent.spokenResponse ?? intent.response;

            if (intent.type === "query") {
              if (spoken) {
                await speechOutput.speak(spoken, nodeId);
                respondedText = spoken;
                outcome = "device-controlled";
              } else if (queryResponder && intent.query) {
                const reply = await queryResponder.respond(intent.query, {
                  residentId: session?.getResidentId(),
                  memories,
                  location: voiceNodeHub.getNode(nodeId)?.location,
                });
                await speechOutput.speak(reply, nodeId);
                respondedText = reply;
                outcome = "device-controlled";
              } else {
                outcome = "unknown-intent";
              }
            } else if (intent.type === "set-resident") {
              if (spoken) await speechOutput.speak(spoken, nodeId);
              getContext(nodeId).reset();
              outcome = "unknown-intent";
            } else if (intent.type === "device-control") {
              if (!intent.deviceLabel || !intent.command) {
                outcome = "unknown-intent";
              } else {
                const device = await devices.findByLabel(intent.deviceLabel);
                if (!device) {
                  const notFoundAudio = await responseAudioCache.lookupNotFound();
                  if (notFoundAudio) {
                    await voiceNodeHub.sendTts(nodeId, notFoundAudio);
                  } else {
                    await speechOutput.speak(`I don't know a device called ${intent.deviceLabel}`, nodeId);
                  }
                  outcome = "unknown-device";
                } else {
                  const resolvedCommand = device.commandMap?.[intent.command] ?? intent.command;
                  await gateway?.publish(device.topic, resolvedCommand);
                  if (spoken) {
                    if (!isLowConfidence) {
                      const cached = await responseAudioCache.lookup({ deviceLabel: intent.deviceLabel, command: intent.command });
                      if (cached) {
                        await voiceNodeHub.sendTts(nodeId, cached);
                      } else {
                        await speechOutput.speak(spoken, nodeId);
                      }
                    } else {
                      await speechOutput.speak(spoken, nodeId);
                    }
                    respondedText = spoken;
                  }
                  outcome = "device-controlled";
                }
              }
            } else if (intent.type !== "create-automation" || !intent.automation) {
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
                    if (spoken) {
                      await speechOutput.speak(spoken, nodeId);
                      respondedText = spoken;
                    }
                    outcome = "automation-created";
                    if (memoryStore && residentId) {
                      const fact = `When ${trigger.deviceLabel} ${trigger.event}, ${actions.map((a) => `${a.command} ${a.deviceLabel}`).join(" and ")}`;
                      await memoryStore.store(residentId, fact);
                    }
                  }
                }
              }
            }
          } catch (err) {
            console.error("[VoiceAutomation] error:", err instanceof Error ? err.message : err);
            outcome = "error";
          } finally {
            if (respondedText) {
              getContext(nodeId).addTurn(transcript, respondedText);
            }
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
      console.log(`[VoiceAutomation] System name: "${systemName}"`);
      voiceNodeHub.onUtterance((nodeId, text) => {
        console.log(`[Heard] [${nodeId}]`, text);
        getWindow(nodeId).addUtterance(text);
      });
      voiceNodeHub.start();
    },
    stop() {
      voiceNodeHub.stop();
      windows.clear();
      contexts.clear();
    },
  };
}
