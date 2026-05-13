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
  TtsStreamOptions,
} from "../ports.js";
import { nullResponseAudioCache } from "./null-response-audio-cache.js";
import type { ResidentSession } from "../memory/resident-session.js";
import { makeListeningWindow } from "./listening-window.js";
import type { ListeningWindow } from "./listening-window.js";
import type { LogStore, DirectedQuestionOutcome } from "../log-store.js";
import { makeConversationContext } from "./conversation-context.js";
import type { ConversationContext } from "./conversation-context.js";

const DEFAULT_HISTORY_TOKEN_BUDGET = 4_000;
const DEFAULT_CONVERSATION_IDLE_TIMEOUT_MS = 30_000;
const DEFAULT_CONVERSATION_FINISHED_THRESHOLD = 0.5;

// ===================================================================
// ISSUE #59: VoiceAutomationService Interruption Orchestration
// ===================================================================
// Status: Core behaviors COMPLETE, Stream lifecycle management PARTIAL
//
// IMPLEMENTED:
// - Stop-word detection (wait, stop, hold on, cancel, no, nope, never mind)
// - Stop confirmation playback (cached audio variants)
// - 3-second response window for yes/no intent
// - Yes/No keyword matching (NOT LLM classification)
// - Unknown intent dispatch on yes
// - Timeout handling
// - Comprehensive interruption logging
//
// NOT YET IMPLEMENTED (requires architectural change):
// - Stream lifecycle tracking (sendTtsStream called from outside VoiceAutomationService)
// - Mode switching integration (ListeningWindow.setMode exists, not yet called)
// - Stream replay on "no" response (token preservation needed)
// - Stream cancellation (VoiceNodeHub.cancel method needed or ignored)
//
// ARCHITECTURE NOTE:
// Full stream orchestration requires exposing sendTtsStream() from
// VoiceAutomationService as a wrapper that tracks stream tokens,
// switches modes, and preserves buffers for replay. This is a
// refactoring task (vertical slice: wrap sendTtsStream).
// ===================================================================

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
  sendTtsStream(nodeId: string, chunks: AsyncIterable<Buffer>, opts?: TtsStreamOptions): Promise<string>;
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
  const inFlightStreams = new Map<string, { token: string; startTime: number }>();
  const awaitingYesNoResponse = new Map<string, { stopWord: string; streamToken?: string; timeout: ReturnType<typeof setTimeout> }>();

  function getContext(nodeId: string, idleTimeoutMs?: number): ConversationContext {
    if (!contexts.has(nodeId)) {
      contexts.set(nodeId, makeConversationContext({ idleTimeoutMs }));
    }
    return contexts.get(nodeId)!;
  }

  function getWindow(nodeId: string): ListeningWindow {
    if (!windows.has(nodeId)) {
      windows.set(nodeId, makeListeningWindow({
        systemName,
        onAmbientUtterance: async (text) => {
          // Check for yes/no response to stop confirmation (if awaiting)
          if (awaitingYesNoResponse.has(nodeId)) {
            const yesRegex = /\b(yes|yeah|yep)\b/i;
            const noRegex = /\b(no|nope|cancel)\b/i;
            if (yesRegex.test(text)) {
              const entry = awaitingYesNoResponse.get(nodeId)!;
              clearTimeout(entry.timeout);
              awaitingYesNoResponse.delete(nodeId);
              console.log(`[VoiceAutomation] Interruption: ${entry.stopWord} → confirmation played → yes → discard`);

              // Discard in-flight stream token
              if (entry.streamToken) {
                inFlightStreams.delete(entry.streamToken);
              }
              return;
            } else if (noRegex.test(text)) {
              const entry = awaitingYesNoResponse.get(nodeId)!;
              clearTimeout(entry.timeout);
              awaitingYesNoResponse.delete(nodeId);
              console.log(`[VoiceAutomation] Interruption: ${entry.stopWord} → confirmation played → no → replay`);

              // Replay the original stream if token is available
              if (entry.streamToken) {
                const buffer = voiceNodeHub.getStreamBuffer(nodeId, entry.streamToken);
                if (buffer && buffer.length > 0) {
                  const chunks = buffer;
                  async function* replayChunks() {
                    for (const chunk of chunks) {
                      yield chunk;
                    }
                  }
                  const window = getWindow(nodeId);
                  window.setMode("stop-word-only");
                  const replayToken = await voiceNodeHub.sendTtsStream(nodeId, replayChunks());
                  inFlightStreams.set(replayToken, { token: replayToken, startTime: Date.now() });
                  window.setMode("normal");
                }
              }
              return;
            }
          }

          // Check for stop-word interruption BEFORE context check
          // so we can interrupt even when not in active conversation
          const stopWords = ["wait", "stop", "hold on", "cancel", "no", "nope", "never mind"];
          const stopWordRegex = new RegExp(`\\b(${stopWords.join("|")})\\b`, "i");
          const stopWordMatch = text.match(stopWordRegex);
          if (stopWordMatch) {
            const confirmationAudio = await responseAudioCache.lookupStopConfirmation();
            if (confirmationAudio) {
              const stopWord = stopWordMatch[1];
              console.log("[VoiceAutomation] Interruption: stop-word → confirmation played");
              await voiceNodeHub.sendTts(nodeId, confirmationAudio);

              // Capture in-flight stream token if one exists
              const streamToken = Array.from(inFlightStreams.keys())[0];

              // Start 3-second window for yes/no response
              const timeout = setTimeout(async () => {
                if (awaitingYesNoResponse.has(nodeId)) {
                  const entry = awaitingYesNoResponse.get(nodeId)!;
                  awaitingYesNoResponse.delete(nodeId);
                  console.log(`[VoiceAutomation] Interruption: ${entry.stopWord} → confirmation played → timeout → replay`);

                  // Try to replay stream if token available
                  if (entry.streamToken) {
                    const buffer = voiceNodeHub.getStreamBuffer(nodeId, entry.streamToken);
                    if (buffer && buffer.length > 0) {
                      const chunks = buffer;
                      async function* replayChunks() {
                        for (const chunk of chunks) {
                          yield chunk;
                        }
                      }
                      const window = getWindow(nodeId);
                      window.setMode("stop-word-only");
                      const replayToken = await voiceNodeHub.sendTtsStream(nodeId, replayChunks());
                      inFlightStreams.set(replayToken, { token: replayToken, startTime: Date.now() });
                      window.setMode("normal");
                    }
                  }
                }
              }, 3000);

              awaitingYesNoResponse.set(nodeId, { stopWord, streamToken, timeout });
              return;
            }
          }

          const cfg = config ? await config.get() : null;
          const threshold = cfg?.intentConfidenceThreshold ?? DEFAULT_CONFIDENCE_THRESHOLD;
          const historyTokenBudget = cfg?.historyTokenBudget ?? DEFAULT_HISTORY_TOKEN_BUDGET;
          const idleTimeoutMs = cfg?.conversationIdleTimeoutMs ?? DEFAULT_CONVERSATION_IDLE_TIMEOUT_MS;

          const ctx = getContext(nodeId, idleTimeoutMs);
          const open = ctx.isOpen();
          console.log(`[VoiceAutomation] ambient utterance "${text}" — context open=${open}`);
          if (!open) return;

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
          const finishedThreshold = cfg?.conversationFinishedThreshold ?? DEFAULT_CONVERSATION_FINISHED_THRESHOLD;
          const finished = intent.conversationFinished ?? 0;
          const shouldCloseContext = finished >= finishedThreshold;
          
          console.log(`[VoiceAutomation] conversationFinished=${finished}, threshold=${finishedThreshold}, shouldClose=${shouldCloseContext}`);
          
          if (shouldCloseContext) {
            console.log("[VoiceAutomation] Conversation finished signal — resetting context BEFORE speech");
            ctx.reset();
          }
          
          let spokenResponse: string | undefined;

          try {
            if (isLowConfidence && (intent.clarifyingQuestion || intent.hedgedResponse)) {
              spokenResponse = intent.clarifyingQuestion ?? intent.hedgedResponse!;
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
            if (!shouldCloseContext) {
              ctx.addTurn(text, spokenResponse ?? "");
            }
          }
        },
        onDirectedQuestion: async (transcript) => {
          const cfg = config ? await config.get() : null;
          const threshold = cfg?.intentConfidenceThreshold ?? DEFAULT_CONFIDENCE_THRESHOLD;
          const idleTimeoutMs = cfg?.conversationIdleTimeoutMs ?? DEFAULT_CONVERSATION_IDLE_TIMEOUT_MS;
          getContext(nodeId, idleTimeoutMs).reset();
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
            const activeResponse = isLowConfidence ? (intent.clarifyingQuestion ?? intent.hedgedResponse ?? intent.response) : intent.response;

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
            } else if (intent.type === "unknown") {
              const cached = await responseAudioCache.lookupUnknownIntentResponse();
              if (cached) {
                await voiceNodeHub.sendTts(nodeId, cached);
              } else {
                await speechOutput.speak("Sorry, I didn't understand that. Could you repeat or rephrase?", nodeId);
              }
              outcome = "unknown-intent";
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
    async sendTtsStream(nodeId: string, chunks: AsyncIterable<Buffer>, opts?: TtsStreamOptions): Promise<string> {
      const window = getWindow(nodeId);
      window.setMode("stop-word-only");
      const token = await voiceNodeHub.sendTtsStream(nodeId, chunks, opts);
      inFlightStreams.set(token, { token, startTime: Date.now() });
      return token;
    },
    start() {
      console.log(`[VoiceAutomation] System name: "${systemName}"`);
      voiceNodeHub.onUtterance((nodeId, text) => {
        console.log(`[Heard] [${nodeId}]`, text);
        getWindow(nodeId).addUtterance(text);
      });
      voiceNodeHub.onStopWord?.((nodeId, keyword) => {
        console.log(`[VoiceAutomation] Stop-word from Pi: ${keyword} [${nodeId}]`);
        // Trigger same interruption flow as server-side detection
        getWindow(nodeId).addUtterance(keyword);
      });
      voiceNodeHub.onTtsStreamComplete?.((nodeId, token) => {
        console.log(`[VoiceAutomation] TTS stream complete: ${token} [${nodeId}]`);
        const window = getWindow(nodeId);
        window.setMode("normal");
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
