Status: done

# Intent Confidence: dashboard threshold control

## What to build

Add `intentConfidenceThreshold` to the dashboard settings card. Persisted in `AppConfig`. Numeric input (0.0–1.0, step 0.05). Shown alongside existing cache controls.

## Acceptance criteria

- [ ] `AppConfig` `intentConfidenceThreshold` persisted via `PUT /api/config`
- [ ] Dashboard settings card shows numeric input for threshold (0.0–1.0, step 0.05, default `0.7`)
- [ ] Value persists across server restart
- [ ] `VoiceAutomationService` reads updated threshold at classification time (not just at startup)
- [ ] All existing tests pass

## Blocked by

- #31 intent-confidence-classifier ✓
- #32 intent-confidence-service-routing ✓
