# TODO

- [x] Define phase-18 scope for sheet-centric browser visual baselines
- [x] Add deterministic sheet scenario harnesses (freeze/overflow/merge/error/dimensions)
- [x] Expand browser visual verifier to compare multiple scenario targets
- [x] Generate or refresh browser baselines for all targets
- [x] Run visual verification command and capture result
- [x] Document review and lessons
- [x] Update `tasks/README.md` table of contents with this task

## Review

- Added deterministic sheet visual scenario harnesses at
  `packages/frontend/src/app/harness/visual/sheet-scenarios.tsx` with five
  browser-captured cases:
  - Freeze + selection rendering
  - Text overflow and clip behavior
  - Merge cell layout
  - Formula error rendering (`#VALUE!`, `#REF!`, `#ERROR!`, `#N/A!`)
  - Custom row/column dimensions with freeze
- Wired the scenario section into
  `packages/frontend/src/app/harness/visual/page.tsx`.
- Expanded `packages/frontend/scripts/verify-visual-browser.mjs` from single
  screenshot compare to multi-target compare:
  - Keeps existing full harness baseline
    (`harness-visual.browser.png`)
  - Adds five scenario-specific baseline files
    (`harness-visual.browser.<scenario>.png`)
  - Emits per-target hash and mismatch output with per-target `.actual` files
- Exported `MemStore` from `@wafflebase/sheet` public index to support
  deterministic frontend harness setup via package API.
- Updated visual baselines:
  - `packages/frontend/tests/visual/baselines/harness-visual.html`
  - `packages/frontend/tests/visual/baselines/harness-visual.browser.png`
  - Added five scenario baseline PNG files under the same baselines directory
- Verification:
  - `pnpm frontend test:visual:update` (pass)
  - `pnpm frontend test:visual:browser:update` (pass)
  - `pnpm frontend test:visual` (pass)
  - `pnpm frontend test:visual:browser` (pass, all 6 targets matched)
  - `pnpm frontend lint` (pass)
