# Entropy Detection Lane (Phase 18)

## Scope

Add `pnpm verify:entropy` lane with dead-code detection (knip) and document
staleness checking, integrated into `verify:self`.

## Deliverables

- [x] Install knip and create workspace-aware `knip.json` config
- [x] Add entropy policy section to `harness.config.json`
- [x] Write doc-staleness detector unit tests (6 tests)
- [x] Implement `scripts/verify-entropy.mjs` with two detectors
- [x] Fix 44 existing entropy findings (7 dead-code, 37 doc-staleness)
- [x] Wire `verify:entropy` into `package.json` and `verify:self` chain
- [x] Update `design/harness-engineering.md` (lane contract, Phase 18, Goal E)
- [x] Update `CLAUDE.md` testing commands section
- [x] Run `verify:fast` end-to-end — all 568 tests pass

## Done

All items complete. Entropy gate is operational and integrated into
`verify:self`.
