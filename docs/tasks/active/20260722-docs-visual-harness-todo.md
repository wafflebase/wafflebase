# Docs — wire up visual regression scenarios in the harness

## Context

Reviewer feedback on the mixed-size line-baseline fixes (PR #507, #515):
docs rendering had no visual regression coverage, so a baseline-alignment
regression like the one those PRs fixed could land silently. Sheets,
cell formatting, charts, and slides all have live scenarios in
`/harness/visual` gated by `verify:frontend:visual`; docs does not.

Two docs baseline PNGs (`docs-styled-text`, `docs-multi-page`) already sit
in `packages/frontend/tests/visual/baselines/` from PR #59, but were never
registered in `verify-visual-browser.mjs`'s `scenarioIds` — they are dead
weight, not a gate. This PR adds a real docs section to the harness,
seeded with the exact case #507/#515 fixed (mixed font-size runs sharing
one line baseline, and a list marker whose Y position must follow the
line's max font size, not the marker's own size).

## Work

- [ ] Add `packages/frontend/src/app/harness/visual/docs-scenarios.tsx`,
  mirroring `format-scenarios.tsx`'s shape (`Scenario`, `ScenarioSetup`,
  `ScenarioCard`-equivalent, ready-state tracking), but backed by
  `@wafflebase/docs`'s `MemDocStore` + `initialize()` instead of
  `@wafflebase/sheets`'s `MemStore`.
  - Scenario 1: one paragraph with three runs at increasing font sizes
    on the same line — verifies they share a baseline instead of each
    floating at its own.
  - Scenario 2: an unordered list item with a marker + mixed-size inline
    text — verifies the marker Y position follows the line max font size.
- [ ] Mount `<DocsVisualScenarios theme={theme} />` in
  `harness/visual/page.tsx` alongside the sheet/format/chart/slides
  sections.
- [ ] Register the new scenario ids in `verify-visual-browser.mjs`'s
  `scenarioIds` list so they're actually captured/compared.
- [ ] Decide the fate of the orphaned `docs-styled-text` /
  `docs-multi-page` baseline PNGs (either wire them up too with a
  matching scenario, or remove as genuinely dead).
- [ ] Capture initial baselines (`pnpm frontend test:visual:browser:update`,
  Docker path per `docs/design/harness-engineering.md` for CI-consistent
  fonts) and commit them.
- [ ] `pnpm verify:fast` green.

## Notes

- `initialize(container, store?, theme?, readOnly?)` from
  `@wafflebase/docs` auto-sizes to the container via `ResizeObserver` and
  exposes `dispose()` for cleanup (sheets' `Spreadsheet` uses `cleanup()`
  instead — mind the naming difference when adapting the `ScenarioCard`
  pattern).
- Playwright/Chromium or Docker may not be available in every dev
  environment; if baseline capture can't run here, leave it as a clearly
  flagged follow-up rather than committing unverified PNGs.
