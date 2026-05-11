export interface ListeningWindowOptions {
  systemName: string;
  windowDurationMs?: number;
  onDirectedQuestion: (transcript: string) => void;
  onAmbientUtterance?: (transcript: string) => void;
}

export interface ListeningWindow {
  addUtterance(text: string, timestampMs?: number): void;
  setMode(mode: "normal" | "stop-word-only"): void;
}

interface Entry {
  text: string;
  timestamp: number;
}

export function makeListeningWindow({
  systemName,
  windowDurationMs = 15_000,
  onDirectedQuestion,
  onAmbientUtterance,
}: ListeningWindowOptions): ListeningWindow {
  const entries: Entry[] = [];
  const nameLower = systemName.toLowerCase();
  const stopWords = ["wait", "stop", "hold on", "cancel", "no", "nope", "never mind"];
  const stopWordRegex = new RegExp(`\\b(${stopWords.join("|")})\\b`, "i");
  let mode: "normal" | "stop-word-only" = "normal";

  const shouldDispatchAmbientUtterance = (text: string): boolean => {
    if (mode === "normal") {
      return true;
    }
    // stop-word-only mode: dispatch only if matches stop-word regex
    return stopWordRegex.test(text);
  };

  return {
    addUtterance(text, timestampMs = Date.now()) {
      const cutoff = timestampMs - windowDurationMs;
      while (entries.length > 0 && entries[0].timestamp < cutoff) {
        entries.shift();
      }
      entries.push({ text, timestamp: timestampMs });

      if (text.toLowerCase().includes(nameLower)) {
        const nameRegex = new RegExp(systemName, "gi");
        const wakeWordRegex = /^(alexa|hey google|ok google|hey siri|siri)[,.\s]*/i;
        // System name in current utterance — use only current utterance as the question
        // (prior window entries are ambient context, not part of this directed question)
        const currentStripped = text.replace(nameRegex, "").replace(wakeWordRegex, "").replace(/\s+/g, " ").trim();
        const isStandalone = currentStripped.replace(/[^a-z]/gi, "").length < 3;

        const transcript = isStandalone
          // Standalone "housekeeper." — include full window for context
          ? entries.map((e) => e.text).join(" ").replace(nameRegex, "").replace(wakeWordRegex, "").replace(/\s+/g, " ").trim()
          : currentStripped;

        console.log("[ListeningWindow] Directed question:", transcript);
        onDirectedQuestion(transcript);
      } else {
        // Ambient utterance: apply mode filtering
        if (shouldDispatchAmbientUtterance(text)) {
          onAmbientUtterance?.(text);
        } else {
          console.log("[ListeningWindow] Suppressed non-stop-word in stop-word-only mode:", text);
        }
      }
    },

    setMode(newMode: "normal" | "stop-word-only") {
      mode = newMode;
    },
  };
}
