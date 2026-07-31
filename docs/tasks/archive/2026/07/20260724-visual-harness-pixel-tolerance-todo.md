# Visual harness pixel tolerance — todo

## Problem

`packages/frontend/scripts/verify-visual-browser.mjs` compares captured
screenshots to baselines with an **exact byte comparison**
(`baseline.equals(captured)`, line 427). Any sub-pixel antialiasing jitter
across CI runs flips the PNG bytes and fails the whole `verify-browser` job.

Observed on PR #544 (a Notes-only change that cannot touch sheet rendering):
`sheet-formula-errors` desktop-light failed with a **3-pixel diff out of
289,680 (0.001%), max channel delta 3/255** at y=104–105 — pure AA
nondeterminism. A re-run passed. This is a structural flake, not a real
regression, and it blocks unrelated PRs.

## Goal

Replace exact-byte comparison with a **perceptual per-pixel threshold +
small pixel-count budget** (the same approach Playwright's own test runner
uses internally), so imperceptible AA jitter passes while genuine visual
changes still fail.

## Non-goals

- Changing what scenarios are captured or how baselines are generated.
- Loosening tolerance enough to mask real regressions.

## Plan

- [x] Diagnose the failure as sub-threshold AA jitter (done via artifact diff).
- [x] Add `pixelmatch` + `pngjs` devDependencies to `@wafflebase/frontend`.
- [x] In `verify-visual-browser.mjs`, replace the `.equals()` branch with a
      `compareImages()` that:
  - decodes both PNGs (pngjs),
  - fails immediately on dimension mismatch (real layout regression),
  - counts perceptually-different pixels via `pixelmatch` (threshold 0.1),
  - passes when `diffPixels <= max(FLOOR, ceil(total * RATIO))`.
  - keeps a byte-identical fast path before decoding.
  - env-overridable: `VISUAL_PIXELMATCH_THRESHOLD`,
    `VISUAL_MAX_DIFF_RATIO` (0.0001), `VISUAL_MAX_DIFF_PIXELS_FLOOR` (20).
- [x] On mismatch, keep writing `*.actual.png` and additionally write a
      `*.diff.png` (pixelmatch diff) for debugging.
- [x] Extend CI artifact glob (`.github/workflows/ci.yml`) + `.gitignore` for
      `*.diff.png`.
- [x] Log the diff-pixel count on both match-within-tolerance and mismatch.
- [x] Note the change in `docs/design/harness-engineering.md`.
- [x] Unit-validate `compareImages` on the real CI flake (0 diff px → pass),
      a 48px synthetic block (fail), a large rect (fail), a dimension change
      (fail). eslint clean.
- [x] Verify: Docker visual lane green (all baselines pass end-to-end).
- [x] `pnpm verify:fast`.
- [x] Self code-review, open PR to `main` (#545).

## Review

Replaced byte-exact PNG comparison in `verify-visual-browser.mjs` with a
`pixelmatch` perceptual per-pixel threshold (0.1) + a small mismatched-pixel
budget (`max(20, ceil(total * 0.0001))`), keeping a byte-identical fast path.
Dimension changes always fail. On a real mismatch it writes `*.actual.png` and
a new `*.diff.png` (uploaded by CI; both gitignored).

Verification:
- Unit-validated `compareImages` numbers against the **real CI flake image**
  (0 over-threshold px → pass), a synthetic 48-px block (fail), a large rect
  (fail), and a dimension change (fail).
- Docker visual lane: **all 220 profile targets matched**, script integrates
  cleanly end-to-end.
- `pnpm verify:fast` green (after a `pnpm install` repaired a pre-existing
  stale `@yorkie-js/sdk` workspace symlink — unrelated to this change).

Tolerance is env-tunable (`VISUAL_PIXELMATCH_THRESHOLD` /
`VISUAL_MAX_DIFF_RATIO` / `VISUAL_MAX_DIFF_PIXELS_FLOOR`). Design note added to
`docs/design/harness-engineering.md`.
