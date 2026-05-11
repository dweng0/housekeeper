# Response replay on unrelated utterance

Status: needs-triage
Category: bug

## What happened

1. Asked "is there a tax on chocolate in the UK?" — system answered about chocolate/VAT
2. Asked "turn on the bedroom light" — system repeated the chocolate answer
3. Response was from previous query, not the new device-control intent

## Expected

Each new utterance should get a fresh response from the LLM. No cross-contamination.

## Suspected causes

1. **Conversation history bug** — previous response included in system message, LLM echoes it
2. **TTS buffer** — audio from first response still in queue, played again
3. **State leak** — `spokenResponse` variable carried across different utterances or intents

## To reproduce

1. Ask any question (e.g., about chocolate)
2. Ask a device control command (e.g., turn on light)
3. Listen for repeated response

## Need to investigate

- Check conversation history contents being sent to LLM
- Check TTS stream/buffer handling in VoiceNodeHub
- Check if spokenResponse is properly scoped per utterance
- Better logging: log sequence of [heard] → [intent] → [speaking] with timestamps/nodeId
