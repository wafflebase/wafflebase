# Visual harness pixel tolerance — lessons

## Context

PR #544 (a Notes-only change) failed CI on the `sheet-formula-errors`
desktop-light visual baseline — a scenario it cannot possibly affect. Root
cause was the visual harness comparing screenshots by **exact SHA-256 of PNG
bytes**, which flakes on non-reproducible Chromium antialiasing.

## Lessons

- **Diagnose before re-running.** Pulling the CI `browser-visual-actual`
  artifact and diffing it against the committed baseline pixel-by-pixel showed
  a **3-pixel, ≤3/255-per-channel** difference — unambiguously sub-pixel AA
  jitter, not a regression. That evidence justified both the immediate re-run
  *and* the structural fix. Don't guess "flaky"; measure it.

- **Exact-byte image comparison is inherently flaky.** GPU/driver/font
  antialiasing is not bit-reproducible across runs or machines. Perceptual
  comparison (`pixelmatch`, YIQ threshold, AA detection on by default) is the
  standard — it's what Playwright's own runner uses. Lean on the per-pixel
  threshold as the primary filter and keep the pixel-count budget *small* so
  real regressions still fail.

- **Validate the tolerance against a real regression, not just the flake.**
  The first ratio (0.0005 → 145 px allowed) let a synthetic 48-px block pass.
  Tightening to 0.0001 (29 px on a 289k image) still absorbs the flake (0
  over-threshold px) but fails a ~40 px change. A tolerance you only test
  against the thing you want to pass is untested against the thing you want to
  catch.

- **`pnpm --filter <pkg> add` can leave sibling workspace symlinks stale.**
  After adding deps to the frontend, the backend's `@yorkie-js/sdk` symlink
  pointed at a pruned `.pnpm/@yorkie-js+sdk@0.7.8` store dir (empty
  package.json) while package.json required 0.7.13, breaking `verify:fast`. A
  plain `pnpm install` re-linked it. CI does a clean install so it's unaffected,
  but locally: after a filtered add, run a top-level `pnpm install` before
  trusting `verify:fast`. This is a local-env artifact, not a code defect.

## Follow-ups

- If specific scenarios later prove noisier than the 20 px / 0.01% budget, tune
  per-run via `VISUAL_PIXELMATCH_THRESHOLD` / `VISUAL_MAX_DIFF_RATIO` /
  `VISUAL_MAX_DIFF_PIXELS_FLOOR` rather than editing code; the `*.diff.png`
  artifact shows exactly which pixels moved.
