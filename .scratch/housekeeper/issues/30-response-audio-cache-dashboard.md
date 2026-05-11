Status: done

# Response Audio Cache: dashboard controls

## What to build

Dashboard controls for the Response Audio Cache: a rebuild button (with a "this may take a while" warning), a variant count selector with disk space labels, and an inline warning when the persona is changed (cache reflects old persona until rebuilt). Variant count stored in `AppConfig`.

## Acceptance criteria

- [x] `AppConfig` gains `responseCacheVariantCount: number` field (default `3`)
- [x] Dashboard settings page shows variant count selector: `3` (medium disk space), `5` (large disk space)
- [x] "Rebuild Cache" button with warning: "Rebuilding may take several minutes depending on the number of devices"
- [x] Rebuild triggers full cache wipe + regenerate via API endpoint; button shows loading state during build
- [x] Persona field change surfaces inline warning: "Cache reflects the previous persona — rebuild recommended after saving"
- [x] Variant count change persists to `AppConfig` and is used by builder on next build
- [x] API endpoint `POST /voice/response-cache/rebuild` triggers full rebuild, returns `202 Accepted`

## Blocked by

- #27 response-audio-cache-builder ✓

## Delivered

- `src/ports.ts` — `responseCacheVariantCount?: number` on `AppConfig`
- `src/index.ts` — config PUT persists `responseCacheVariantCount`; `POST /api/voice/response-cache/rebuild` wipes cache dir and triggers full rebuild with current config's variant count, returns 202
- `client/src/App.tsx` — `AppConfig` interface updated; settings card shows variant count + "Rebuild Cache" button with loading/done/error states + idle warning text; edit form adds variant count selector and inline persona-changed warning
- `client/src/App.test.tsx` — fixed pre-existing test failure (missing `/api/voice-nodes` and `/api/logs` mocks)
