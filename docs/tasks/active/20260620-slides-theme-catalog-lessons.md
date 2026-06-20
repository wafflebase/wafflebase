# Slides Theme Catalog — Lessons

## Process

- Root cause of "brand melted into themes" was concrete:
  `default-light.ts` / `default-dark.ts` bind accents to
  `@wafflebase/tokens` `palette.syrup/butter/berry/leaf`. Element colors
  store `{ kind: 'role' }`, so the brand palette renders on every
  role-bound element of every new deck. The fix is data-only; the model
  (`Theme`, flat picker) already supports an arbitrary number of themes.

## Gotchas

- Theme thumbnails are **live-rendered** from the `Theme` literal
  (`theme-thumbnail.tsx`) — no PNG/SVG assets — so adding themes costs ~0
  bundle/asset. Confirmed before sizing the expansion.
- De-branding `default-light` is **not lossless**: existing decks'
  role-bound colors shift (syrup → neutral blue). This is intended, but
  must be called out as a migration note, not hidden.
- `verify-entropy.mjs` doc-ref check (`scripts/verify-entropy.mjs`) only
  scans **top-level** `docs/design/*.md` (non-recursive readdir), so
  `docs/design/slides/*.md` backtick refs are not gated — but the
  `docs/design/README.md` link to the new doc **is** gated and must
  resolve. Keep planned/not-yet-existing files out of backtick
  `name.ext` form anyway, for honesty.

## Outcomes

- **Bundle gate:** passed unchanged. `verify:frontend:chunks` stayed
  green after going 5 → 23 themes. Confirmed the pre-flight assumption:
  thumbnails are live-rendered from the `Theme` literal, so themes are
  pure data tree-shaken into the slides chunk — no PNG/SVG assets.
- **Contrast:** all 23 themes passed WCAG-AA (text over both background
  and backgroundAlt) on the first run — **no palette adjustment was
  needed**. The hand-authored palettes were all dark-on-light or
  light-on-dark with comfortable margin.

## Plan gap caught during execution

- The visual-scenario set is defined in **two** places that must stay in
  lockstep: `packages/frontend/src/app/harness/visual/slides-scenarios.tsx`
  (the scenario objects) **and** a hardcoded `scenarioIds` array in
  `packages/frontend/scripts/verify-visual-browser.mjs`. The plan named
  only the first. The Task 5 implementer caught the second; without it the
  Docker baseline-update run would not cover the new scenarios. **Lesson:**
  when retargeting harness visual scenarios, grep the whole `frontend`
  package for the scenario ids — the runner keeps its own allow-list.
  Beware the decoy id `slides-canvas-shapes-catalog-material` (a shapes
  scenario, not the Material theme) — do not remove it.

## CI break + fix (the big one)

The first PR push failed `verify-browser` in CI. Root cause: **changing a
default theme's palette changes the rendered output of EVERY visual
scenario that paints that theme — not just the theme-grid scenarios.**
De-branding `default-light`/`default-dark` shifted ~94 slides baselines
(toolbars, layouts, shape catalogs, multi-resize, pickers, theme-panel,
and the tiled composite `harness-visual.browser.png`). Task 5 had rolled
these back as "Docker render noise," so the PR shipped stale baselines.

Two compounding mistakes, both worth remembering:

1. **Wrong rollback in Task 5.** The "amd64-under-Rosetta noise" theory was
   over-applied: I told the implementer to keep only the 6 theme-grid
   baselines and `git checkout --` everything else. But local Docker
   **byte-matches CI** (proven: the 6 committed theme baselines matched CI
   exactly). So the rolled-back files were legitimate, deterministic
   changes. **Lesson:** when a change alters a shared default (theme,
   token, font), regenerate ALL baselines and commit every file that
   changes; do not assume off-target diffs are noise — verify by checking
   whether the same files reproduce a change on a second run.

2. **Misread the CI log.** `gh run view <id> --log-failed` prints the
   WHOLE failed step, including every `Baseline matched` line. A broad
   `grep …png` over that output captured matched files too, making the
   failure look like it hit chart/sheet/format scenarios. **Lesson:** read
   only the block between `Visual baseline mismatches detected:` and
   `Inspect mismatches …` (`sed -n '/mismatches detected/,/Inspect/p'`);
   the `actual output:` lines are the true mismatch set.

Fix: `pnpm verify:browser:docker:update`, commit the 94 changed
baselines, push. (The first local update run flaked with a harness-root
timeout; a retry succeeded — Docker startup is occasionally slow.)

## Env note

- The Docker visual lane image is amd64 under Rosetta on arm64. It is
  byte-deterministic with CI (theme baselines matched on the first try),
  but the harness page can intermittently fail to mount
  (`waiting for [data-testid='visual-harness-root']` timeout) — just
  retry the run.
