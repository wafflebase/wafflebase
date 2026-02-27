# TODO

- [x] Define scope for moving frontend test assets outside runtime `src`
- [x] Move frontend Node test files from `src/` to `tests/`
- [x] Move visual baseline assets from `src/visual-tests` to `tests/visual`
- [x] Update frontend test scripts and visual verifier paths
- [x] Run frontend test and visual verification commands
- [x] Update task index with this task

## Review

- Moved frontend unit/smoke tests to `packages/frontend/tests`:
  - `tests/api/http-error.test.ts`
  - `tests/api/single-flight.test.ts`
  - `tests/lib/utils.test.ts`
  - `tests/app/documents/migration.test.ts`
  - `tests/app/documents/tab-name.test.ts`
- Updated imports in moved tests to target runtime code under `src/`.
- Moved visual baselines to `packages/frontend/tests/visual/baselines`:
  - `harness-visual.html`
  - `harness-visual.browser.png`
- Updated script paths:
  - `packages/frontend/package.json`
    - `test`, `test:watch` now target `tests/**/*.test.ts`
  - `packages/frontend/scripts/verify-visual.mjs`
  - `packages/frontend/scripts/verify-visual-browser.mjs`
    - both now read/write baselines in `tests/visual/baselines`
- Verification:
  - `pnpm frontend test` (pass)
  - `pnpm frontend test:visual` (pass)
  - `pnpm frontend test:visual:browser` (pass)
