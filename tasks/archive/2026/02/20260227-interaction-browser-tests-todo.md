# TODO

- [x] Define deterministic interaction test scope (cell edit, formula edit, wheel scroll)
- [x] Add interaction harness route/page with stable test bridge APIs
- [x] Add Playwright browser interaction verifier script
- [x] Wire frontend/root verification commands for interaction lane
- [x] Update README/design docs for new interaction lane
- [x] Run interaction verification and capture outcomes
- [x] Document review and lessons
- [x] Update task indexes

## Review

All interaction browser test infrastructure is complete and operational:

- **Harness page**: `packages/frontend/src/app/harness/interaction/page.tsx`
  exposes `window.__WB_INTERACTION__` bridge API for test automation.
- **Verifier script**: `packages/frontend/scripts/verify-interaction-browser.mjs`
  runs three scenarios (cell input, formula input, wheel scroll) via Playwright.
- **Verification command**: `pnpm verify:frontend:interaction:browser` wired in
  both frontend and root `package.json`.
- **CI integration**: Included in `verify:self` lane contract.
- **Design docs**: `design/harness-engineering.md` updated with interaction lane
  documentation and Phase 17 follow-up completion status.
