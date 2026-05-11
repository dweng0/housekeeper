Status: done

# Intent Confidence: classifier output + ports

## What to build

Add `intentConfidence: number` (0–1) and `hedgedResponse?: string` to `ClassifiedIntent` in `ports.ts`. Update `openai-intent-classifier.ts` system prompt to instruct the LLM to return both fields. Update `ClassifiedIntent` type and all relevant type guards.

## Acceptance criteria

- [ ] `ClassifiedIntent` in `ports.ts` gains `intentConfidence: number` (0–1) and `hedgedResponse?: string`
- [ ] `AppConfig` in `ports.ts` gains `intentConfidenceThreshold?: number` (default `0.7`)
- [ ] Classifier system prompt instructs LLM to return `intentConfidence` and `hedgedResponse` on all non-`unknown` intents
- [ ] `hedgedResponse` phrased to signal uncertainty while still acting (e.g. *"I think you're asking me to turn on the hallway light — done"*)
- [ ] Classifier unit tests updated: returned intent includes `intentConfidence` and `hedgedResponse`
- [ ] `unknown` type returns no confidence field (or ignored downstream)
- [ ] All existing tests pass

## Blocked by

None — start here
