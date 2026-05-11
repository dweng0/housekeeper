Status: needs-triage

# Cast Node: mDNS key verification and session reconnect

## What to build

Verify that `bonjour-service` correctly reads the Cast device UUID from the mDNS `txt` record for a real Nest Mini, then add reconnect logic to `CastVoiceNodeHub` so that a failed or expired Cast session recovers automatically.

Currently `handleFound` reads `service.txt.id` as the UUID. If the key differs on real hardware, the device is silently skipped. If the session drops (device reboot, timeout), subsequent `sendTts` calls fail with no recovery.

## Acceptance criteria

- [ ] Confirmed (against real Nest Mini) which `txt` key holds the Cast device UUID — update `bonjour-cast-discovery.ts` to use the correct key, with a fallback log if no UUID is found
- [ ] `CastVoiceNodeHub.sendTts` reconnects via `CastClientFactory.connect` if the current `CastClient` throws on `playUrl`
- [ ] Reconnect is attempted once; if it fails, the response is dropped with a warning (same behaviour as WS node offline)
- [ ] Existing Cast hub tests still pass; add a test for the reconnect-on-failure path using the fake client factory

## Blocked by

None - can start immediately
