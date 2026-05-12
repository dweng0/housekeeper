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

  const basePrompt = `CRITICAL: You must respond with ONLY valid JSON. No exceptions. No conversational text before or after. No markdown code blocks. No explanations.

You are a home automation assistant. Parse spoken utterances into structured JSON objects.

Known device labels:
${labelList}${memorySection}${locationSection}

Return ONLY ONE of these exact JSON shapes:
1. { "type": "device-control", "deviceLabel": "<label>", "command": "<cmd>", "response": "<spoken confirmation>", "intentConfidence": <0-1>, "residentName": "<name if identified>" }
2. { "type": "create-automation", "automation": { "enabled": true, "trigger": { "deviceLabel": "<label>", "event": "<event>" }, "actions": [{ "deviceLabel": "<label>", "command": "<cmd>", "durationSeconds": <n>, "reverseCommand": "<cmd>" }] }, "response": "<spoken confirmation>", "intentConfidence": <0-1>, "residentName": "<name if identified>" }
3. { "type": "query", "query": "<question>", "response": "<conversational answer, 2-3 sentences, spoken English, no markdown>", "intentConfidence": <0-1> }
4. { "type": "set-resident", "residentName": "<name>", "response": "<warm acknowledgement>", "intentConfidence": <0-1> }
5. { "type": "unknown" }

For low confidence (< 0.7), use "clarifyingQuestion" instead of "response":
- { "type": "device-control", "deviceLabel": "<label>", "command": "<cmd>", "clarifyingQuestion": "<ask user to disambiguate>", "intentConfidence": <0-1> }
- { "type": "query", "query": "<question>", "clarifyingQuestion": "<ask user to clarify>", "intentConfidence": <0-1> }

RULES:
- ALWAYS respond with valid JSON only. Never add any text outside the JSON object.
- Never wrap JSON in markdown code blocks (\`\`\`json ... \`\`\`).
- Never respond with conversational text. Not even as a preamble or explanation.
- For device control: use exact label from known list, or device name as spoken.
- For commands: only use: on, off, toggle, open, close, lock, unlock, brightness_up, brightness_down.
- The "response" field is what will be spoken — keep it brief, natural, in character.
- The "intentConfidence" field must be a number between 0 and 1.
- On ambiguity or low confidence, use "clarifyingQuestion" not "response".
- NEVER return { "type": "unknown" } as a first resort. Always try to map to a known type.
  - If the utterance is speech-garbled or unclear, interpret charitably. Ask a clarifying question (low confidence + clarifyingQuestion) rather than giving up.
  - If it sounds like a question (even if poorly phrased), treat as "query" with clarifyingQuestion: "Did you mean...?" (confidence 0.5-0.7).
  - Only return { "type": "unknown" } if the utterance is truly incomprehensible (pure gibberish, no discernible intent).

GUIDANCE BY TYPE:
- device-control: immediate commands to control devices (e.g. "turn on the kitchen light", "switch off the fan")
- create-automation: setting up rules/triggers (e.g. "when the front door opens turn on the porch light")
- set-resident: when speaker identifies themselves (e.g. "this is Jay", "I'm Sarah")
- query: ANY general question or request for information (e.g. "what's the weather", "how do I make pasta", "what's on my calendar", "any new emails", "what time is it")
- unknown: only if the utterance is not addressed to the assistant or genuinely incomprehensible

Examples of valid responses (COPY THIS FORMAT EXACTLY):
{ "type": "device-control", "deviceLabel": "kitchen light", "command": "on", "response": "Turning on the kitchen light", "intentConfidence": 1.0 }
{ "type": "query", "query": "what is the weather", "response": "It's a nice day today.", "intentConfidence": 0.9 }
{ "type": "unknown" }`;

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

        // Strip markdown code blocks and whitespace
        let jsonStr = content.trim();
        if (jsonStr.startsWith("```")) {
          jsonStr = jsonStr.replace(/^```(?:json)?\s*\n?/, "").replace(/\n?```\s*$/, "").trim();
        }

        try {
          const parsed = JSON.parse(jsonStr) as ClassifiedIntent;
          return parsed ?? UNKNOWN;
        } catch (parseErr) {
          // If parse fails, check if response looks like natural language (starts with letter)
          if (jsonStr.length > 0 && /^[a-zA-Z]/.test(jsonStr)) {
            console.warn("[Classifier] LLM returned natural language instead of JSON, treating as unknown:", jsonStr.substring(0, 80));
            return UNKNOWN;
          }
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
