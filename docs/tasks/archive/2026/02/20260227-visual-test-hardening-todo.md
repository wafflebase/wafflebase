# TODO

- [x] Define visual test hardening scope with deterministic profile strategy
- [x] Expand browser visual verifier to capture desktop and mobile profiles
- [x] Regenerate browser visual baselines for all profile/target combinations
- [x] Update visual test docs for strengthened coverage
- [x] Run verification commands and capture outcomes
- [x] Document review and lessons
- [x] Update task indexes

## Review

- Expanded browser visual verification in
  `packages/frontend/scripts/verify-visual-browser.mjs`:
  - Added deterministic capture profiles: `desktop` + `mobile`
  - Kept existing desktop baseline names for backward compatibility
  - Added mobile baseline naming suffix: `.mobile.png`
  - Compared/updated all `(profile x visual-target)` combinations
- Updated browser visual baselines under
  `packages/frontend/tests/visual/baselines/` with mobile variants:
  - `harness-visual.browser.mobile.png`
  - `harness-visual.browser.sheet-*.mobile.png`
- Updated docs to reflect strengthened coverage:
  - `README.md`
  - `packages/frontend/README.md`
  - `design/harness-engineering.md`
- Verification:
  - `pnpm frontend test:visual:browser:update` (pass)
  - `pnpm verify:frontend:visual:all` (pass, 12 profile targets matched)
