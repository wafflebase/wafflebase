# Lessons — Slides Shapes P3-B (Google Slides parity sweep)

> Fill in during and after the sweep. Pattern matches predecessor lessons docs in `docs/tasks/archive/2026/05/20260512-slides-shapes-p3a2-sweep-lessons.md` and `20260510-slides-shapes-p3a-pilot-lessons.md`.

## Scope reconciliation

_Capture every disagreement between the todo's "Scope reference" inferred table and the actual path-builder math. Aim to fix the table in place at discovery time and note here why the row was wrong. (P3-A.2 found 3 disagreements in 24 rows; P3-B has 62 rows + new axis type so expect more.)_

## Axis-type assignments that surprised

_Where the OOXML preset definition didn't match the apparent axis on a quick read. E.g.: `pie` looks like 2× angular but one of its `<a:gd>` entries is sometimes encoded as 21600000ths instead of 60000ths — confirm during implementation._

## Factory consolidation decisions

| Family | Outcome | Why |
|---|---|---|
| Curved arrows (4) | TBD | |
| Snip/round-corner rects (7) | TBD | |
| Sector shapes (pie/arc/chord/blockArc) | TBD | |
| Line callouts (3) | TBD | |
| Banner scrolls (horizontal/vertical) | TBD | |

## `polylineArc` segment-count revisions

_Document if any shape needed a per-shape override of `DEFAULT_ARC_SEGMENTS` (e.g. `circularArrow` at large radius)._

## Angular winding-disambiguation edge cases

_The `atan2` wrap-around at 0°/360° is handled by carrying `startAdjustments` in the apply closure. Note any shape where the heuristic broke (e.g. cross-quadrant drag with a high start angle), and the fix._

## Action button rendering

_Body + glyph two-pass paint. Note any per-button quirk: which glyph paths needed manual coordinate tuning, whether any glyph collided with the 4 px bevel inset at small frames._

## Pre-commit hook timeout

_P3-A.2 lessons §8 covered this. Re-confirm here whether 600 s was sufficient for the larger P3-B diff, and whether commit-output redirect to `$CLAUDE_JOB_DIR/commit-T*.log` worked as before._

## Visual harness whitelist

_Confirm whether the four new scenario IDs were added to `verify-visual-browser.mjs` in the same commit as the scenarios. P3-A.2 missed this and silently skipped the new scenario the first time._

## Picker icon legibility at 24 px

_The 62 new shapes include 12 action button glyphs and 7 snip/round-rect variants — both prone to looking similar at small icon size. Note any rendering tweak (stroke width override, glyph simplification) made for picker preview only._

## What to do differently for the next phase (P3-C or later)

_Carry-forward recommendations once the sweep is shipped._
