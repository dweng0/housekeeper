Status: needs-triage

# 47 — TTS Streaming Toggle UI

## What to build

Expose `ttsStreamingEnabled` config setting in the dashboard UI. Allow users to toggle streaming mode without editing JSON config file.

Currently config must be set directly in `data/config.json`:
```json
{ "ttsStreamingEnabled": false }
```

## Why needed

Kokoro endpoint may not support true streaming (`stream: true`). When streaming is disabled, system falls back to buffered mode (old behavior). Users should be able to toggle this in the dashboard instead of manual config editing.

## Acceptance criteria

- [ ] Dashboard settings page shows "TTS Streaming" toggle
- [ ] Toggle reflects current `ttsStreamingEnabled` value from config
- [ ] Toggle saves change to config when clicked
- [ ] On/off state persists after page reload
- [ ] Help text explains: "Enable for faster response playback; disable if Kokoro doesn't support streaming"

## Blocked by

None — UI only, no backend changes needed.

## Depends on

- Issue 44 (TTS streaming implementation with fallback)
