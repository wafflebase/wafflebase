---
title: docs-table-row-splitting
target-version: 0.4.0
---

# Table Row Splitting Across Pages

## Summary

Allow table rows to split across page boundaries so that tall rows
(especially those containing nested tables or long text) render
continuously instead of jumping to the next page and leaving blank
space.

## Goals

- Split table rows at page boundaries when a row does not fit on the
  current page.
- Recurse into nested tables — rows inside a nested table follow the
  same splitting rules.
- Handle rowSpan/colSpan merged cells that straddle a page split.
- Re-draw cell borders and backgrounds on each page fragment so that
  every page looks visually complete.
- Preserve cursor placement, arrow-key navigation, text selection, and
  scroll-into-view across split rows.

## Non-Goals

- Splitting a single text line across pages (a text line is atomic).
- Splitting an image block across pages (an image is atomic; if it
  exceeds page height it gets its own page).
- Rebalancing content between pages to minimise whitespace (standard
  "keep-with-next" / "widow-orphan" logic is out of scope).

## Atomic Units

| Unit | Splittable? |
|------|-------------|
| Text line (one visual line of text) | No |
| Image block | No |
| Table row | Yes — between text lines / blocks inside cells |
| Nested-table row | Yes — recursively |

A split point is always *between* two atomic units inside a cell, never
in the middle of one.

## Proposal Details

### 1. Layout / Pagination Layer

File: `packages/docs/src/view/pagination.ts`

#### 1.1 Split-point calculation

When a table row does not fit in the remaining page space:

1. Compute `availableHeight` = remaining space on the current page.
2. For each cell in the row, walk its content lines (text lines,
   image blocks, nested-table rows) and find the last line whose
   cumulative height ≤ `availableHeight`.
3. Take the **minimum** across all cells — that is the safe split
   height where every cell can break without cutting an atomic unit.
4. If the minimum is 0 (no line fits), push the entire row to the next
   page (current behaviour).

#### 1.2 Nested-table recursion

When a cell line is a nested table row, apply the same split algorithm
recursively. The nested table row may itself split, producing a partial
height that feeds back into the parent cell's line-walk.

#### 1.3 rowSpan handling

A rowSpan cell spans multiple logical rows. When a page break falls
inside the span:

- The cell's content is split at the same `splitHeight` as the row that
  triggers the break.
- On the next page the cell continues rendering from the split point,
  with its remaining rowSpan rows.

#### 1.4 Data model extension — `PageLine`

Add optional fields to `PageLine`:

```ts
interface PageLine {
  // ... existing fields ...

  /** For split table rows: vertical offset into the row where this
      page fragment starts (0 for the first fragment). */
  rowSplitOffset?: number;

  /** For split table rows: height of this fragment on this page. */
  rowSplitHeight?: number;
}
```

The paginator emits two (or more) `PageLine` entries for the same
`blockIndex + lineIndex` when a row is split — one per page, each with
its own `rowSplitOffset` / `rowSplitHeight`.

### 2. Rendering Layer

Files: `packages/docs/src/view/doc-canvas.ts`,
       `packages/docs/src/view/table-renderer.ts`

#### 2.1 Clipped cell rendering

When painting a split row fragment:

1. Save canvas state, set a clip rect to the fragment's height.
2. Translate the cell content up by `rowSplitOffset` so the correct
   slice of content is visible.
3. Render text lines / images / nested tables as normal — the clip rect
   hides out-of-bounds content.
4. Restore canvas state.

#### 2.2 Border re-drawing

For every page that contains a row fragment:

- **Top of fragment**: draw the cell's top border (even if this is a
  continuation from the previous page).
- **Bottom of fragment**: draw the cell's bottom border (even if the
  row continues on the next page).

This gives each page a visually complete table appearance.

#### 2.3 Background fill

Fill the cell background colour for the visible fragment area only,
before rendering cell content.

#### 2.4 Nested-table fragments

When a cell contains a nested table that is itself split, the cell
renderer delegates to the table renderer recursively.  Each nested
fragment follows the same clip + translate + border rules.

### 3. Interaction Layer

Files: `packages/docs/src/view/text-editor.ts`,
       `packages/docs/src/view/pagination.ts` (pixel ↔ position)

#### 3.1 Pixel → position (`paginatedPixelToPosition`)

Extend to account for `rowSplitOffset`. When a click lands on a split
row fragment, add the fragment's `rowSplitOffset` to the local Y before
resolving to a text position inside the cell.

#### 3.2 Position → pixel (`findPageForPosition` / `getPixelForPosition`)

When the cursor is inside a split row, determine which page fragment
contains the cursor's line, then compute the pixel Y relative to that
page.

#### 3.3 Arrow-key navigation

`moveVertical` already handles page-boundary crossings.  Split rows
add one new case: the cursor is at the last visible line of a fragment
and presses Down — it should move to the first line of the next
fragment (same row, next page) rather than to the next row.

#### 3.4 Selection rendering

`renderSelection` clips selection highlight rectangles to the current
page's fragment bounds, the same way cell content is clipped.

#### 3.5 Scroll into view

When the cursor moves into a split row fragment on a different page,
`scrollIntoView` targets that page's Y offset.

## Risks and Mitigation

| Risk | Impact | Mitigation |
|------|--------|------------|
| Performance — split calculation for deeply nested tables | Slow layout on large docs | Cache split results per row; only recompute dirty rows |
| Correctness — rowSpan cells with complex merges | Visual glitches at split boundaries | Start with simple cases; add merge-specific tests |
| Complexity — recursive split + render + interaction | Large diff, hard to review | Implement in phases: pagination → rendering → interaction |
| Regression — existing non-split table rendering | Broken tables | Existing tests must keep passing; split logic is additive |
