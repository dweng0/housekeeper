export interface ListeningWindowOptions {
  systemName: string;
  windowDurationMs?: number;
  onDirectedQuestion: (transcript: string) => void;
}

export interface ListeningWindow {
  addUtterance(text: string, timestampMs?: number): void;
}

interface Entry {
  text: string;
  timestamp: number;
}

export function makeListeningWindow({
  systemName,
  windowDurationMs = 15_000,
  onDirectedQuestion,
}: ListeningWindowOptions): ListeningWindow {
  const entries: Entry[] = [];
  const nameLower = systemName.toLowerCase();

  return {
    addUtterance(text, timestampMs = Date.now()) {
      const cutoff = timestampMs - windowDurationMs;
      while (entries.length > 0 && entries[0].timestamp < cutoff) {
        entries.shift();
      }
      entries.push({ text, timestamp: timestampMs });

      if (text.toLowerCase().includes(nameLower)) {
        onDirectedQuestion(entries.map((e) => e.text).join(" "));
      }
    },
  };
}
