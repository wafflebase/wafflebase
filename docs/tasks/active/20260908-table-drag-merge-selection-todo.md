# Docs: table drag selection drops the columns a colspan merge covers (#1049)

## Problem

Issue #1049 reports that dragging a cell range across a row holding a
`colSpan: 2` cell paints a rectangle with the wrong column span: the merged
columns light up only inside the merged row, and one gesture leaves the
anchor cell outside the selection. The issue names two candidates — an
un-expanded rectangle reaching the renderer, or `buildCellRangeRects()`
dropping cells — and says it is not root-caused.

## Findings (measured, not assumed)

Driving the four reported gestures end-to-end through real pointer events
against a **top-level** table on `main` produces the *correct* rectangle in
every case, so neither candidate holds there. What does hold is the same
contract failing one step earlier:

- `normalizeRange()` (`selection.ts`) looks the table up with a flat
  `layout.blocks.find(...)`. A **nested** table is not a top-level layout
  block, so the lookup misses, `table` is `undefined`, and the defensive
  read-time `expandCellRangeForMerges()` at `selection.ts:112` silently does
  nothing. The painter one function away (`buildCellRangeRects`) already
  resolves nested tables via `resolveNestedTableLayout()`. Measured: an inner
  table whose row 1 holds a `colSpan: 2` cell keeps the un-expanded
  `(0,0)–(2,0)` rectangle, which paints exactly the picture #1049 describes.
- Shift+clicking a cell in another row creates no cell range at all — the
  `else` arm at `text-editor.ts:2021` collapses the caret. The drag path and
  the keyboard shift+arrow path both build a `tableCellRange`; shift+click is
  the odd one out. #1049 files this as context in the same issue.

## Plan

1. `selection.ts` — resolve the table through `resolveNestedTableLayout()` so
   read-time merge expansion runs for every table, nested included.
2. `text-editor.ts` — shift+click on a different cell of the same table builds
   an `expandCellRangeForMerges()`-grown `tableCellRange`, mirroring the drag
   path.
3. Tests
   - end-to-end pointer-driven regression for the four gestures in the issue,
     asserting the bounding-rectangle contract and that the anchor cell is
     always highlighted;
   - shift+click across rows produces the same rectangle as the equivalent
     drag;
   - unit test pinning nested-table read-time expansion.

## Out of scope

- Re-deriving the production-only symptom on a top-level table. It does not
  reproduce on `main`; the PR says so rather than claiming a fix it cannot
  demonstrate. The new tests would catch it if it regresses.
