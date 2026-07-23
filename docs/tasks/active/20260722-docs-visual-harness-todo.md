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
- [ ] Add before/after screenshots of the two new docs scenarios to PR
  #527's description once CI is green.

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
- **CI `verify-browser` failure — root cause found and fixed:**
  adding `DocsVisualScenarios` to the harness page deterministically
  perturbs sub-pixel rendering of ~19 *unrelated* chart/slides baselines
  captured later on the same page load (byte-diff only; visually
  indistinguishable side-by-side). Ruled out, with direct evidence:
  - Not baseline drift or a floating Docker image tag: a clean
    `upstream/main` checkout (no docs changes) passes all 212 targets in
    the same Docker image, matching the exact baseline hashes that fail
    on this branch.
  - Not CI-vs-local environment mismatch: reproduced the identical 19
    mismatches, with byte-identical "actual" hashes, running
    `bash scripts/run-browser-tests-docker.sh visual` locally.
  - Not flaky/non-deterministic: two separate CI runs on this branch
    disagreed on which subset mismatched only because the first run
    predated the Docker-captured docs baselines being committed; after
    accounting for that, the remaining 19 reproduce identically every
    time.
  - Not the documented Google-Fonts mount-race (the leading suspect,
    since that race is explicitly called out in
    `verify-visual-browser.mjs`'s comments): added a second
    `document.fonts.check()` pass after every section-ready wait,
    including a missing `slidesSection` wait (a real, independent gap —
    the script never confirmed slides had finished mounting before
    capturing slides screenshots) — same 19 mismatches, byte-identical
    actual hashes before and after. Reverted this change; not worth
    carrying speculative code that doesn't demonstrably fix anything.
  - Leading remaining hypothesis: the two new docs-editor canvas mounts
    add real main-thread layout/paint work that shifts timing or
    anti-aliasing for sibling chart/slides canvases rendered in the same
    capture pass — a side effect of composing more canvas-heavy
    components on one shared page, not a bug in any single scenario.
  - **Fix landed:** each section (sheet/format/docs/chart/slides) now
    gets its own isolated page load via a `section` query param on
    `/harness/visual` (`page.tsx`'s `useSectionFromSearchParams`); the
    default/absent value still renders the full assembled page for
    manual browsing and for the one `harness-root` full-page baseline,
    which intentionally keeps the shared-page composition since it's
    meant to catch whole-page layout regressions. `verify-visual-browser.mjs`
    groups `scenarioIds` by section (`SECTION_SCENARIOS`) and captures
    each section from its own `context.newPage()` navigation
    (`capturePass`), waiting only on that section's own ready-flag
    instead of every section's. All 220 baselines were regenerated under
    the new architecture (structural change, not drift) and verified
    stable across three consecutive Docker capture runs. A trade-off to
    watch: page-load count went from 4 to ~24 (4 profiles × (1 root + 5
    sections)); each load is lighter, and total runtime didn't regress
    in local testing, but worth another look if CI time grows.
