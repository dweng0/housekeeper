import type { ClassifiedIntent } from "./ports.js";

export type DirectedQuestionOutcome =
  | "automation-created"
  | "duplicate-automation"
  | "unknown-device"
  | "unknown-intent"
  | "error";

export interface DirectedQuestionEntry {
  type: "directed-question";
  timestamp: string;
  nodeId: string;
  transcript: string;
  intent: ClassifiedIntent;
  outcome: DirectedQuestionOutcome;
}

export interface AutomationFiringEntry {
  type: "automation-firing";
  timestamp: string;
  automationId: string;
  triggerTopic: string;
  triggerPayload: string;
  actions: { topic: string; command: string }[];
}

export type LogEntry = DirectedQuestionEntry | AutomationFiringEntry;

const MAX_ENTRIES = 500;

export interface LogStore {
  append(entry: LogEntry): void;
  getAll(): LogEntry[];
}

export function makeLogStore(): LogStore {
  const entries: LogEntry[] = [];
  return {
    append(entry) {
      entries.unshift(entry);
      if (entries.length > MAX_ENTRIES) entries.length = MAX_ENTRIES;
    },
    getAll() {
      return [...entries];
    },
  };
}
