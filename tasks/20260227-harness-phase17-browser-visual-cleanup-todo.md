# TODO

- [x] Define phase-17 follow-up scope for browser visual checks and docker cleanup hardening
- [x] Add a Playwright-based browser visual baseline verifier for `/harness/visual`
- [x] Expose browser visual verifier commands at frontend/root script layers
- [x] Harden `verify:integration:docker` with interruption-safe cleanup paths
- [x] Update harness documentation and command references for new behavior
- [x] Run available verification commands and record environment constraints
- [x] Update `tasks/README.md` table of contents with this task

## Review

- Added browser-rendered visual regression verifier:
  - `packages/frontend/scripts/verify-visual-browser.mjs`
  - Captures deterministic screenshot baseline from `/harness/visual` using
    headless Chromium via Playwright.
  - Supports baseline refresh through
    `UPDATE_VISUAL_BROWSER_BASELINE=true`.
  - Writes `.actual` screenshot and hash summary on mismatch.
  - Emits explicit install guidance when Playwright dependency or browser
    binaries are missing.
- Added command wiring:
  - Frontend:
    - `pnpm frontend test:visual:browser`
    - `pnpm frontend test:visual:browser:update`
  - Root:
    - `pnpm verify:frontend:visual:browser`
- Hardened docker integration wrapper (`scripts/verify-integration-docker.mjs`):
  - Added signal handlers for `SIGINT`/`SIGTERM`.
  - Added idempotent cleanup (`stopPostgresIfNeeded`) and
    `finally`-based cleanup path.
  - Ensures postgres started by script is stopped on normal and interrupted
    execution paths.
- Updated docs:
  - `README.md`, `packages/frontend/README.md`, `CLAUDE.md`
  - `design/harness-engineering.md` lane contract + immediate next work.
- Verification:
  - `node --check packages/frontend/scripts/verify-visual-browser.mjs` (pass)
  - `node --check scripts/verify-integration-docker.mjs` (pass)
  - `pnpm verify:self` (pass)
  - `pnpm verify:integration:docker` (pass; migrations + backend e2e)
  - `pnpm verify:frontend:visual:browser` (pass after Playwright +
    Chromium install and baseline creation)
