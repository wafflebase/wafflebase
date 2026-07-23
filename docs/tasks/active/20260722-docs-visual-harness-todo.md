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

- [x] Add `packages/frontend/src/app/harness/visual/docs-scenarios.tsx`,
  mirroring `format-scenarios.tsx`'s shape (`Scenario`, `ScenarioSetup`,
  `ScenarioCard`-equivalent, ready-state tracking), but backed by
  `@wafflebase/docs`'s `MemDocStore` + `initialize()` instead of
  `@wafflebase/sheets`'s `MemStore`.
  - Scenario 1: one paragraph with three runs at increasing font sizes
    on the same line — verifies they share a baseline instead of each
    floating at its own.
  - Scenario 2: an unordered list item with a marker + mixed-size inline
    text — verifies the marker Y position follows the line max font size.
- [x] Mount `<DocsVisualScenarios theme={theme} />` in
  `harness/visual/page.tsx` alongside the sheet/format/chart/slides
  sections.
- [x] Register the new scenario ids in `verify-visual-browser.mjs`'s
  `scenarioIds` list so they're actually captured/compared.
- [x] Decide the fate of the orphaned `docs-styled-text` /
  `docs-multi-page` baseline PNGs — removed. No code ever produced them
  (confirmed via `git log`/`git show` on PR #59); they never gated
  anything and don't match the new scenario content.
- [x] Capture initial baselines via `bash scripts/run-browser-tests-docker.sh
  visual:update` (CI-consistent Docker/Chromium) and commit them. Note: a
  full `visual:update` run regenerates every scenario's baseline (220
  targets logged), not just the new ones — this run also produced real
  pixel drift across nearly all of the pre-existing baselines (different
  Docker image/font versions than whatever produced the currently-
  committed ones). That drift is out of scope for this PR, so only the 8
  new `docs-mixed-font-size-*` PNGs were committed; every other
  regenerated baseline was reverted via `git checkout --` before staging.
- [x] `pnpm verify:fast` green.

## Notes

- `initialize(container, store?, theme?, readOnly?)` from
  `@wafflebase/docs` auto-sizes to the container via `ResizeObserver` and
  exposes `dispose()` for cleanup (sheets' `Spreadsheet` uses `cleanup()`
  instead — mind the naming difference when adapting the `ScenarioCard`
  pattern).
- Playwright/Chromium or Docker may not be available in every dev
  environment; if baseline capture can't run here, leave it as a clearly
  flagged follow-up rather than committing unverified PNGs.
- **Bug found and fixed along the way:** at the mobile capture profile
  (430px viewport, below the `xl:grid-cols-2` breakpoint), the scenario
  grid had no explicit column template, so the track sized to
  max-content. The docs canvas has no CSS width of its own — only an
  intrinsic pixel-width attribute set by `editor.ts`'s `paint()`, which
  measures `container.parentElement`'s width — so an unconstrained
  max-content column and the canvas's own reported width fed back into
  each other every `ResizeObserver` tick, growing without bound (a card
  literally grew from ~1000px to ~14500px wide across 3 seconds) and
  hanging Playwright's scroll-into-view stability check. Fixed by adding
  an explicit `grid-cols-1` so the column is always `minmax(0, 1fr)`
  regardless of breakpoint. Verified via a throwaway debug harness
  polling `getBoundingClientRect()` before/after the fix — confirmed
  stable afterward, and confirmed both scenarios screenshot correctly
  (checked visually, not just structurally) via a local Playwright run.
- This PR's commit (`d8b9b264`) sits on `feat/docs-visual-harness`,
  branched from `main`/`upstream/main`. It was originally drafted on top
  of `fix/docs-undo-selection` (a concurrent, unrelated session's commit
  `c3ba681c`) after a branch mix-up; verified the 12-file diff is
  byte-identical whether based on `c3ba681c` or `f0db0785` before
  finalizing, so no undo/selection changes leaked into this branch.
