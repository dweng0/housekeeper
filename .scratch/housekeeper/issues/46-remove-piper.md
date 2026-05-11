Status: needs-triage

# 46 — Remove Piper

## What to build

Delete Piper TTS machinery now that Kokoro is the sole renderer. Supersedes issues 12 and 36.

Files to delete:
- `src/voice/piper-tts-adapter.ts`
- `src/voice/piper-tts-renderer.ts`
- `src/voice/piper-daemon-tts-renderer.ts`
- `src/voice/piper-daemon-tts-renderer.test.ts`

Also remove:
- Any `PIPER_*` env var references in `devenv.nix`, `devenv.local.nix`, `.env.example`
- Piper-related wiring in `src/index.ts`
- `scripts/download-piper-voice.sh` if it exists
- References in `docs/` or `README` (if any)

ADR 0005 is superseded by ADR 0008 — add a "Superseded by ADR 0008" note to `docs/adr/0005-tts-engine-piper.md`.

## Acceptance criteria

- [ ] All `piper-*.ts` source and test files deleted
- [ ] No `PIPER_*` env vars remain in devenv or example config
- [ ] `src/index.ts` has no Piper imports or wiring
- [ ] `docs/adr/0005-tts-engine-piper.md` marked superseded by ADR 0008
- [ ] Project builds and all tests pass after removal

## Blocked by

- `44-kokoro-live-streaming`
