# Fix: table cell paste across a merged region breaks the table

## Problem

In a Docs table (also reachable from Slides table cells, which reuse the
Docs engine), copying a cell range that touches a merged region and pasting
it breaks the table structure.

Reported repro: 3x3 table, select a 2x2 region overlapping a merge, copy,
paste into a single cell → table renders broken.

## Root cause

Table cell copy/paste preserves merge span metadata verbatim:

- `getSelectedTableCells` (`text-editor.ts`) slices the selected cells
  including `colSpan` / `rowSpan` and `colSpan: 0` covered markers.
- `cloneTableCells` (`clipboard.ts`) keeps those spans.
- `pasteTableCells` (`text-editor.ts`) writes them into the destination
  with only edge clamping — it never re-establishes a consistent merge
  structure.

The layout (`table-layout.ts`) trusts the grid invariant (an anchor's span
matches `colSpan: 0` covered cells, all in bounds). Paste violates it two ways:

1. **Orphaned covered cell** — copy a range whose top-left is a covered cell
   (anchor outside the copy) → pasted `colSpan: 0` with no anchor.
2. **Span overrun** — paste a merged anchor near the edge → covered cells fall
   out of bounds, anchor claims a span with no matching covered cells.

Both empirically confirmed by replicating the copy/paste data flow.

## Plan

- [x] Add `normalizeTableMerges(td: TableData)` pure helper in `model/types.ts`
      that repairs the invariant in place (clamp anchors to bounds, mark
      covered cells, restore orphaned covered cells, first-anchor-wins on
      overlap).
- [x] Call it in `pasteTableCells` for both branches (in-table paste and
      new-table-from-cells) before persisting.
- [x] Regression test reproducing the broken grids the copy/paste flow
      produces and asserting the helper repairs them.
- [x] `pnpm verify:fast` green.

## Review

Fix is contained: one pure helper (`normalizeTableMerges`, 62 lines) plus two
call sites in `pasteTableCells`. The helper repairs the merge invariant the
layout trusts, so it covers every paste source (internal WAFFLEDOCS payload,
HTML table, markdown table) and both Docs and Slides (Slides table cells reuse
the Docs `TextEditor`).

Decisions:
- Repair the **destination** grid after paste rather than sanitizing the copied
  source — one place catches orphaned covered cells, overrunning anchors, and
  even destination merges straddling the paste boundary.
- Edge-overrun anchors clamp to the grid; if that leaves a 1x1 they become
  normal cells (drop the unfulfillable span) but keep their content.
- Overlap resolved row-major, first-anchor-wins (deterministic).
- Healthy merges are untouched (verified), so running over the whole table is
  safe.

Regression test: `test/model/table-merge-normalize.test.ts` (4 cases). Each
broken case asserts `gridViolations(...) > 0` before normalize and `=== []`
after, proving both the bug and the fix. Full docs suite (60 files) and
`pnpm verify:fast` green.
