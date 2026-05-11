Status: needs-info

# 48 — TTS stream generated but no audio playback

## What's broken

When asking a question:
- LLM generates response (visible in logs)
- TTS stream starts
- TTS service logs "stream producer finished"
- No error logs
- **No audio plays on speaker**

## Example flow

1. User: "What's the weather?"
2. Dev logs: LLM response present
3. TTS service: "stream started"
4. TTS service: "stream producer finished"
5. Speaker: silence

## Environment context

Recent commit `4479a2c` switched to remote Kokoro TTS (192.168.1.112:8001) with minimal request format. Commit notes: "adding explicit model/voice/response_format parameters causes server to return silence (server-side issue to investigate)."

## Triage Notes

**What we've established:**
- Stream lifecycle completes (start → producer finished)
- No error logs in TTS or voice services
- LLM intent classification working
- Likely connection point: Kokoro TTS response handling or Pi audio device not receiving stream frames

**What we still need:**
1. What does the TTS request look like? (URL, headers, body)
2. What parameters are being sent to Kokoro? (is it minimal `{"input":"text"}` or including model/voice?)
3. Can you capture the raw response from Kokoro in devenv logs? (byte count, format)
4. Does the Pi audio device show any errors? (sounddevice logs)
5. Is this issue new after commit `4479a2c` or was it happening before Kokoro switch?
