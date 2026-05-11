import type { ClassifiedIntent, ConfigRepository, DeviceRepository, IntentClassifier } from "../ports.js";

interface OpenAIClassifierOptions {
  endpoint: string;
  model: string;
  devices: DeviceRepository;
  apiKey?: string;
  persona?: string;
  systemName?: string;
  config?: ConfigRepository;
}

const UNKNOWN: ClassifiedIntent = { type: "unknown" };

function buildSystemPrompt(deviceLabels: string[], memories: string[], location?: string, persona?: string, systemName?: string): string {
  const labelList = deviceLabels.length > 0
    ? deviceLabels.map((l) => `- ${l}`).join("\n")
    : "(none registered)";

  const memorySection = memories.length > 0
    ? `\n\nResident context:\n${memories.map((m) => `- ${m}`).join("\n")}`
    : "";

  const locationSection = location ? `\nOriginating location: ${location}` : "";

  const basePrompt = `You are a home automation assistant. Parse spoken utterances into structured JSON.

Known device labels:
${labelList}${memorySection}${locationSection}

Return JSON matching one of these shapes:
- { "type": "device-control", "deviceLabel": "<label>", "command": "<cmd>", "response": "<spoken confirmation>", "hedgedResponse": "<uncertain variant>", "intentConfidence": <0-1>, "residentName": "<name if identified>" }
- { "type": "create-automation", "automation": { "enabled": true, "trigger": { "deviceLabel": "<label>", "event": "<event>" }, "actions": [{ "deviceLabel": "<label>", "command": "<cmd>", "durationSeconds": <n>, "reverseCommand": "<cmd>" }] }, "response": "<spoken confirmation>", "hedgedResponse": "<uncertain variant>", "intentConfidence": <0-1>, "residentName": "<name if identified>" }
- { "type": "query", "query": "<question>", "response": "<conversational answer, 2-3 sentences, spoken English, no markdown>", "hedgedResponse": "<uncertain variant>", "intentConfidence": <0-1> }
- { "type": "set-resident", "residentName": "<name>", "response": "<warm acknowledgement>", "hedgedResponse": "<uncertain variant>", "intentConfidence": <0-1> }
- { "type": "unknown" }

Use "device-control" for immediate commands to control devices (e.g. "turn on the kitchen light", "switch off the fan"). Use the exact label from the known list if it matches; otherwise use the device name as spoken — the system will handle unregistered devices.
Use "create-automation" for setting up rules/triggers (e.g. "when the front door opens turn on the porch light").
Use "set-resident" when the speaker identifies themselves (e.g. "this is Jay", "I'm Sarah").
Use "query" for any general question or request for information (e.g. "what temperature is the sun", "who invented the lightbulb", "what's the weather like").
Use "unknown" only if the utterance is not addressed to the assistant or the intent is genuinely unclear.
For the "command" field use only: on, off, toggle, open, close, lock, unlock, brightness_up, brightness_down.
The "response" field is spoken aloud — keep it brief, natural, and in character. If the utterance identifies a resident alongside an action, include "residentName" on that intent and address them by name in "response".
The "intentConfidence" field is a 0–1 float: your certainty that you correctly identified the intent from the utterance. Use 1.0 for clear, unambiguous utterances; lower values when the utterance is vague, fragmented, or could mean multiple things.
The "hedgedResponse" field is a variant of "response" phrased to signal uncertainty — e.g. "I think you're asking me to turn on the hallway light — done." Always include it alongside "response" for all non-unknown types.
Return only valid JSON, no markdown.`;

  if (!persona) return basePrompt;

  const processedPersona = systemName
    ? persona.replace("{SYSTEM_NAME}", systemName)
    : persona;

  return `${processedPersona}\n\n${basePrompt}`;
}

export function makeOpenAIIntentClassifier(opts: OpenAIClassifierOptions): IntentClassifier {
  return {
    async classify({ utterance, memories = [], location, conversationHistory = [] }) {
      try {
        const allDevices = await opts.devices.findAll();
        const deviceLabels = allDevices.map((d) => d.label);

        let persona = opts.persona;
        let systemName = opts.systemName;

        if (opts.config) {
          const config = await opts.config.get();
          persona = config.persona;
          systemName = config.systemName;
        }

        const headers: Record<string, string> = { "Content-Type": "application/json" };
        if (opts.apiKey) headers["Authorization"] = `Bearer ${opts.apiKey}`;

        const response = await fetch(`${opts.endpoint}/chat/completions`, {
          method: "POST",
          headers,
          body: JSON.stringify({
            model: opts.model,
            messages: [
              { role: "system", content: buildSystemPrompt(deviceLabels, memories, location, persona, systemName) },
              ...conversationHistory,
              { role: "user", content: utterance },
            ],
            response_format: { type: "json_object" },
          }),
        });

        const data = await response.json() as { choices: { message: { content: string } }[] };
        const content = data.choices[0].message.content;
        console.log("[Classifier] LLM response:", content);
        
        // Strip markdown code blocks if present
        let jsonStr = content.trim();
        if (jsonStr.startsWith("```")) {
          jsonStr = jsonStr.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
        }
        
        try {
          const parsed = JSON.parse(jsonStr) as ClassifiedIntent;
          return parsed ?? UNKNOWN;
        } catch (parseErr) {
          console.error("[Classifier] JSON parse error:", parseErr instanceof Error ? parseErr.message : parseErr);
          console.error("[Classifier] Raw content:", content);
          return UNKNOWN;
        }
      } catch (err) {
        console.error("[Classifier] error:", err instanceof Error ? err.message : err);
        return UNKNOWN;
      }
    },
  };
}
