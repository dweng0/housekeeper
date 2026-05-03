import type { ClassifiedIntent, DeviceRepository, IntentClassifier } from "../ports.js";

interface OpenAIClassifierOptions {
  endpoint: string;
  model: string;
  devices: DeviceRepository;
}

const UNKNOWN: ClassifiedIntent = { type: "unknown" };

function buildSystemPrompt(deviceLabels: string[], memories: string[]): string {
  const labelList = deviceLabels.length > 0
    ? deviceLabels.map((l) => `- ${l}`).join("\n")
    : "(none registered)";

  const memorySection = memories.length > 0
    ? `\n\nResident context:\n${memories.map((m) => `- ${m}`).join("\n")}`
    : "";

  return `You are a home automation assistant. Parse spoken utterances into structured JSON.

Known device labels:
${labelList}${memorySection}

Return JSON matching one of these shapes:
- { "type": "create-automation", "automation": { "enabled": true, "trigger": { "deviceLabel": "<label>", "event": "<event>" }, "actions": [{ "deviceLabel": "<label>", "command": "<cmd>", "durationSeconds": <n>, "reverseCommand": "<cmd>" }] } }
- { "type": "query", "query": "<question>" }
- { "type": "unknown" }

Use "unknown" if the utterance is not addressed to the assistant or intent is unclear.
Only reference device labels from the known list above.
Return only valid JSON, no markdown.`;
}

export function makeOpenAIIntentClassifier(opts: OpenAIClassifierOptions): IntentClassifier {
  return {
    async classify(utterance, _residentId, memories = []) {
      try {
        const allDevices = await opts.devices.findAll();
        const deviceLabels = allDevices.map((d) => d.label);

        const response = await fetch(`${opts.endpoint}/chat/completions`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model: opts.model,
            messages: [
              { role: "system", content: buildSystemPrompt(deviceLabels, memories) },
              { role: "user", content: utterance },
            ],
            response_format: { type: "json_object" },
          }),
        });

        const data = await response.json() as { choices: { message: { content: string } }[] };
        const content = data.choices[0].message.content;
        const parsed = JSON.parse(content) as ClassifiedIntent;
        return parsed ?? UNKNOWN;
      } catch (err) {
        console.error("[Classifier] error:", err instanceof Error ? err.message : err);
        return UNKNOWN;
      }
    },
  };
}
