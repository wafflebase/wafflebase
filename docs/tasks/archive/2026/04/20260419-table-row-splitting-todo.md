# Table Row Splitting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split tall table rows across page boundaries so content renders continuously instead of leaving blank space or clipping.

**Architecture:** Extend `paginateLayout()` to detect rows that exceed remaining page space and compute a split height based on cell content lines. Each split produces two `PageLine` entries (one per page) with `rowSplitOffset`/`rowSplitHeight` metadata. The renderer clips cell content to the fragment bounds and re-draws borders on each page. Coordinate mapping and navigation are updated to handle the split fragments.

**Tech Stack:** TypeScript, Canvas 2D, Vitest

**Spec:** `docs/design/docs/docs-table-row-splitting.md`

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `packages/docs/src/view/pagination.ts` | Modify | Row split calculation, `PageLine` extension, split `PageLine` emission |
| `packages/docs/src/view/table-layout.ts` | Modify | Export cell content line heights for split calculation |
| `packages/docs/src/view/doc-canvas.ts` | Modify | Pass split metadata to table renderer, adjust `tableOriginY` |
| `packages/docs/src/view/table-renderer.ts` | Modify | Clip cell content by split offset/height, re-draw borders |
| `packages/docs/src/view/text-editor.ts` | Modify | Arrow navigation across split row fragments |
| `packages/docs/test/view/pagination.test.ts` | Modify | Add row-splitting test cases |
| `packages/docs/test/view/table-row-split.test.ts` | Create | Dedicated split rendering and interaction tests |

---

### Task 1: Extend `PageLine` with split metadata

**Files:**
- Modify: `packages/docs/src/view/pagination.ts:7-13`

- [ ] **Step 1: Add `rowSplitOffset` and `rowSplitHeight` to `PageLine`**

In `packages/docs/src/view/pagination.ts`, extend the `PageLine` interface:

```typescript
export interface PageLine {
  blockIndex: number;
  lineIndex: number;
  line: LayoutLine;
  x: number;
  y: number;

  /** For split table rows: vertical offset into the row where this
      page fragment starts (0 for the first fragment). */
  rowSplitOffset?: number;

  /** For split table rows: height of this fragment on this page.
      When undefined the full row height is used. */
  rowSplitHeight?: number;
}
```

- [ ] **Step 2: Verify existing tests still pass**

Run: `cd packages/docs && pnpm vitest run test/view/pagination.test.ts`
Expected: All existing tests pass (no behaviour change yet).

- [ ] **Step 3: Commit**

```
git add packages/docs/src/view/pagination.ts
git commit -m "Add rowSplitOffset/rowSplitHeight fields to PageLine"
```

---

### Task 2: Export cell content line heights from table layout

The paginator needs to know the cumulative content heights inside each
cell so it can find a safe split point. Add a helper that returns line
heights for a given row.

**Files:**
- Modify: `packages/docs/src/view/table-layout.ts`

- [ ] **Step 1: Write failing test**

Create `packages/docs/test/view/table-row-split.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { computeTableLayout, getCellContentBreakpoints } from '../../src/view/table-layout.js';
import type { TableData } from '../../src/model/types.js';
import { createMockContext } from '../helpers.js';

describe('getCellContentBreakpoints', () => {
  it('returns cumulative line heights for a single-cell row', () => {
    // Build a simple 1×1 table with 3 text lines
    const tableData: TableData = {
      columnWidths: [1],
      rows: [{
        cells: [{
          blocks: [{ id: 'b1', type: 'paragraph', inlines: [
            { text: 'Line 1' },
            { text: 'Line 2' },
            { text: 'Line 3' },
          ], style: {} }],
          colSpan: 1, rowSpan: 1,
        }],
      }],
    };
    const ctx = createMockContext();
    const layout = computeTableLayout(tableData, 'tbl', ctx, 200);
    const breakpoints = getCellContentBreakpoints(layout, 0);

    // breakpoints should be an array of cumulative heights for each
    // atomic unit (text line) across all cells in the row
    expect(breakpoints.length).toBeGreaterThan(0);
    // Each entry is the cumulative height at which a break is safe
    for (let i = 1; i < breakpoints.length; i++) {
      expect(breakpoints[i]).toBeGreaterThan(breakpoints[i - 1]);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/docs && pnpm vitest run test/view/table-row-split.test.ts`
Expected: FAIL — `getCellContentBreakpoints` not exported.

- [ ] **Step 3: Implement `getCellContentBreakpoints`**

In `packages/docs/src/view/table-layout.ts`, add after `computeTableLayout`:

```typescript
/**
 * Return sorted array of safe vertical break positions within a table row.
 * Each value is a cumulative height (relative to the row top) at which
 * all cells in the row have an atomic-unit boundary (text line or image end).
 * The paginator can split the row at any of these heights.
 */
export function getCellContentBreakpoints(
  layout: LayoutTable,
  rowIndex: number,
): number[] {
  const padding = DEFAULT_CELL_PADDING;
  const cells = layout.cells[rowIndex];
  if (!cells || cells.length === 0) return [];

  // Collect per-cell breakpoint sets
  const perCell: Set<number>[] = [];
  for (let c = 0; c < cells.length; c++) {
    const cell = cells[c];
    if (cell.merged) continue; // skip covered cells
    const breaks = new Set<number>();
    let y = padding;
    for (const line of cell.lines) {
      y += line.height;
      breaks.add(y);
    }
    perCell.push(breaks);
  }

  if (perCell.length === 0) return [];

  // Intersect: only keep heights where ALL non-merged cells have a break
  const first = perCell[0];
  const common: number[] = [];
  for (const h of first) {
    if (perCell.every(s => s.has(h))) {
      common.push(h);
    }
  }
  common.sort((a, b) => a - b);
  return common;
}
```

Note: intersection is the strict version. If no common breakpoints exist
(cells have different line heights), the row cannot be split and stays
atomic. A later refinement can use "closest safe height per cell" instead
of strict intersection.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/docs && pnpm vitest run test/view/table-row-split.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```
git add packages/docs/src/view/table-layout.ts packages/docs/test/view/table-row-split.test.ts
git commit -m "Add getCellContentBreakpoints for row split calculation"
```

---

### Task 3: Split rows in `paginateLayout()`

Replace the atomic row placement (lines 63–83) with logic that attempts
to split a row when it doesn't fit.

**Files:**
- Modify: `packages/docs/src/view/pagination.ts:63-83`
- Test: `packages/docs/test/view/table-row-split.test.ts`

- [ ] **Step 1: Write failing test for row splitting**

Add to `packages/docs/test/view/table-row-split.test.ts`:

```typescript
import { paginateLayout } from '../../src/view/pagination.js';
import { computeLayout } from '../../src/view/layout.js';
import type { Block } from '../../src/model/types.js';
import { resolvePageSetup, getEffectiveDimensions } from '../../src/view/pagination.js';

describe('paginateLayout — row splitting', () => {
  it('splits a tall table row across two pages', () => {
    // Create a table block with one row whose cell content is taller
    // than the page content area
    const tableBlock: Block = {
      id: 'table1',
      type: 'table',
      inlines: [],
      style: {},
      tableData: {
        columnWidths: [1],
        rows: [{
          cells: [{
            blocks: Array.from({ length: 40 }, (_, i) => ({
              id: `p${i}`,
              type: 'paragraph' as const,
              inlines: [{ text: `Line ${i}` }],
              style: {},
            })),
            colSpan: 1,
            rowSpan: 1,
          }],
        }],
      },
    };
    const ctx = createMockContext();
    const pageSetup = resolvePageSetup(undefined);
    const dims = getEffectiveDimensions(pageSetup);
    const contentWidth = dims.width - pageSetup.margins.left - pageSetup.margins.right;
    const layout = computeLayout([tableBlock], ctx, contentWidth).layout;
    const paginated = paginateLayout(layout, pageSetup);

    // The table should span at least 2 pages
    expect(paginated.pages.length).toBeGreaterThanOrEqual(2);

    // First page should have a PageLine with rowSplitOffset = 0
    const firstPageTableLines = paginated.pages[0].lines.filter(
      l => l.rowSplitHeight !== undefined
    );
    expect(firstPageTableLines.length).toBe(1);
    expect(firstPageTableLines[0].rowSplitOffset).toBe(0);

    // Second page should have a PageLine with rowSplitOffset > 0
    const secondPageTableLines = paginated.pages[1].lines.filter(
      l => l.rowSplitOffset !== undefined
    );
    expect(secondPageTableLines.length).toBe(1);
    expect(secondPageTableLines[0].rowSplitOffset).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/docs && pnpm vitest run test/view/table-row-split.test.ts`
Expected: FAIL — row is not split, only 1 page or row pushed to page 2 whole.

- [ ] **Step 3: Implement row splitting in `paginateLayout()`**

In `packages/docs/src/view/pagination.ts`, replace the table row loop
(lines 63–83) with split-aware logic:

```typescript
// Inside paginateLayout(), replace the table row handling section:
import { getCellContentBreakpoints } from './table-layout.js';

// ... inside the table block branch (lb.layoutTable exists):
const tl = lb.layoutTable!;
for (let ri = 0; ri < tl.rowHeights.length; ri++) {
  const rowHeight = tl.rowHeights[ri];

  // Row fits on current page — no split needed
  if (currentY + rowHeight <= contentHeight || isPageTop) {
    currentPage.lines.push({
      blockIndex: bi,
      lineIndex: ri,
      line: { runs: [], y: tl.rowYOffsets[ri], height: rowHeight, width: availableWidth },
      x: margins.left,
      y: margins.top + currentY,
    });
    currentY += rowHeight;
    isPageTop = false;
    continue;
  }

  // Row doesn't fit — try to split
  const availableForRow = contentHeight - currentY;
  const breakpoints = getCellContentBreakpoints(tl, ri);

  // Find the largest breakpoint that fits in available space
  let splitHeight = 0;
  for (const bp of breakpoints) {
    if (bp <= availableForRow) {
      splitHeight = bp;
    } else {
      break;
    }
  }

  if (splitHeight <= 0) {
    // No safe split point fits — push entire row to next page
    startNewPage();
    currentPage.lines.push({
      blockIndex: bi,
      lineIndex: ri,
      line: { runs: [], y: tl.rowYOffsets[ri], height: rowHeight, width: availableWidth },
      x: margins.left,
      y: margins.top + currentY,
    });
    currentY += rowHeight;
    isPageTop = false;
    continue;
  }

  // Emit first fragment on current page
  currentPage.lines.push({
    blockIndex: bi,
    lineIndex: ri,
    line: { runs: [], y: tl.rowYOffsets[ri], height: rowHeight, width: availableWidth },
    x: margins.left,
    y: margins.top + currentY,
    rowSplitOffset: 0,
    rowSplitHeight: splitHeight,
  });

  // Continue emitting fragments on subsequent pages
  let consumed = splitHeight;
  while (consumed < rowHeight) {
    startNewPage();
    const remaining = rowHeight - consumed;
    const pageAvailable = contentHeight;

    // Find next split point within this page
    let fragmentHeight = remaining; // default: rest fits on this page
    if (remaining > pageAvailable) {
      // Need another split
      fragmentHeight = 0;
      for (const bp of breakpoints) {
        if (bp > consumed && bp - consumed <= pageAvailable) {
          fragmentHeight = bp - consumed;
        }
      }
      if (fragmentHeight <= 0) {
        // No split point fits — give entire page to this fragment
        fragmentHeight = Math.min(remaining, pageAvailable);
      }
    }

    currentPage.lines.push({
      blockIndex: bi,
      lineIndex: ri,
      line: { runs: [], y: tl.rowYOffsets[ri], height: rowHeight, width: availableWidth },
      x: margins.left,
      y: margins.top + currentY,
      rowSplitOffset: consumed,
      rowSplitHeight: fragmentHeight,
    });
    consumed += fragmentHeight;
    currentY += fragmentHeight;
    isPageTop = false;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/docs && pnpm vitest run test/view/table-row-split.test.ts`
Expected: PASS

- [ ] **Step 5: Run all existing pagination tests**

Run: `cd packages/docs && pnpm vitest run test/view/pagination.test.ts`
Expected: All existing tests PASS (non-split rows unchanged).

- [ ] **Step 6: Commit**

```
git add packages/docs/src/view/pagination.ts packages/docs/test/view/table-row-split.test.ts
git commit -m "Split tall table rows across pages in paginateLayout"
```

---

### Task 4: Render split row fragments

Update the table rendering pipeline to clip cell content and re-draw
borders for each page fragment.

**Files:**
- Modify: `packages/docs/src/view/doc-canvas.ts:83-115` (collectTableRenderRanges)
- Modify: `packages/docs/src/view/table-renderer.ts:165-480` (renderTableContent)
- Test: `packages/docs/test/view/table-row-split.test.ts`

- [ ] **Step 1: Update `collectTableRenderRanges` to carry split metadata**

In `packages/docs/src/view/doc-canvas.ts`, extend `TableRenderRange`:

```typescript
interface TableRenderRange {
  layoutBlock: LayoutBlock;
  tableX: number;
  tableOriginY: number;
  pageStartRow: number;
  renderStartRow: number;
  endRowIndex: number;
  /** When the row is split, the vertical offset into the row. */
  rowSplitOffset?: number;
  /** When the row is split, the height of this fragment. */
  rowSplitHeight?: number;
}
```

In `collectTableRenderRanges()`, pass through split fields from `PageLine`:

```typescript
// After computing range, add:
range.rowSplitOffset = pl.rowSplitOffset;
range.rowSplitHeight = pl.rowSplitHeight;
```

And adjust `tableOriginY` for split fragments:

```typescript
// When rowSplitOffset is set, the origin needs adjustment
const rowY = lb.layoutTable!.rowYOffsets[pl.lineIndex];
const splitOffset = pl.rowSplitOffset ?? 0;
range.tableOriginY = pageY + pl.y - rowY - splitOffset;
// This way (tableOriginY + rowY + splitOffset) == (pageY + pl.y)
// i.e. the visible content starts at pl.y on the page
```

- [ ] **Step 2: Update `renderTableContent` to clip split fragments**

In `packages/docs/src/view/table-renderer.ts`, `renderTableContent()`:

Add parameters for split info and apply clipping:

```typescript
export function renderTableContent(
  ctx: CanvasRenderingContext2D,
  tableData: TableData,
  layout: LayoutTable,
  tableX: number,
  tableY: number,
  startRow: number,
  endRow: number,
  pageStartRow: number,
  // ... existing params ...
  rowSplitOffset?: number,
  rowSplitHeight?: number,
): void {
  // When rendering a split fragment, clip to the fragment bounds
  const isSplit = rowSplitOffset !== undefined && rowSplitHeight !== undefined;
  if (isSplit) {
    const splitRow = startRow; // the row being split
    const clipY = tableY + layout.rowYOffsets[splitRow] + rowSplitOffset;
    ctx.save();
    ctx.beginPath();
    ctx.rect(tableX, clipY, layout.totalWidth, rowSplitHeight);
    ctx.clip();
  }

  // ... existing rendering logic unchanged ...

  if (isSplit) {
    ctx.restore();
  }
}
```

- [ ] **Step 3: Re-draw borders on fragment boundaries**

After the clip-restore in `renderTableContent`, draw fragment borders:

```typescript
if (isSplit) {
  ctx.restore();

  // Draw top border of fragment
  const splitRow = startRow;
  const fragTop = tableY + layout.rowYOffsets[splitRow] + rowSplitOffset;
  const fragBottom = fragTop + rowSplitHeight;

  ctx.strokeStyle = '#000';
  ctx.lineWidth = 1;

  // Top border
  ctx.beginPath();
  ctx.moveTo(tableX, fragTop);
  ctx.lineTo(tableX + layout.totalWidth, fragTop);
  ctx.stroke();

  // Bottom border
  ctx.beginPath();
  ctx.moveTo(tableX, fragBottom);
  ctx.lineTo(tableX + layout.totalWidth, fragBottom);
  ctx.stroke();

  // Vertical cell borders within fragment
  for (const xOff of layout.columnXOffsets) {
    ctx.beginPath();
    ctx.moveTo(tableX + xOff, fragTop);
    ctx.lineTo(tableX + xOff, fragBottom);
    ctx.stroke();
  }
  // Right edge
  ctx.beginPath();
  ctx.moveTo(tableX + layout.totalWidth, fragTop);
  ctx.lineTo(tableX + layout.totalWidth, fragBottom);
  ctx.stroke();
}
```

- [ ] **Step 4: Update `renderTableBackgrounds` similarly**

Apply the same clip logic for cell backgrounds in split fragments.

- [ ] **Step 5: Wire split metadata through `DocCanvas.render()`**

In `doc-canvas.ts`, pass `rowSplitOffset`/`rowSplitHeight` from
`TableRenderRange` to `renderTableContent()` and `renderTableBackgrounds()`.

- [ ] **Step 6: Run full test suite**

Run: `cd packages/docs && pnpm vitest run`
Expected: All tests pass.

- [ ] **Step 7: Manual browser test**

Open the shared document, scroll to the "프로젝트 개요" area. Verify:
- The tall row is split across pages
- Cell borders appear on both pages
- Cell content is clipped correctly (no bleed)
- No blank space on the previous page

- [ ] **Step 8: Commit**

```
git add packages/docs/src/view/doc-canvas.ts packages/docs/src/view/table-renderer.ts
git commit -m "Render split table row fragments with clipping and borders"
```

---

### Task 5: Update coordinate mapping for split rows

`paginatedPixelToPosition` and `findPageForPosition` must handle split
row fragments so that clicks and cursor placement work correctly.

**Files:**
- Modify: `packages/docs/src/view/pagination.ts` (paginatedPixelToPosition, findPageForPosition)

- [ ] **Step 1: Update `paginatedPixelToPosition`**

When a click lands on a split row fragment, the local Y within the cell
must account for `rowSplitOffset`. In `paginatedPixelToPosition()`:

```typescript
// After finding the target PageLine (targetPL), check for split:
if (targetPL.rowSplitOffset !== undefined) {
  // Adjust localY to account for the split offset
  // The cell content visible on this page starts at rowSplitOffset
  // So the effective Y within the cell = localY relative to fragment top + rowSplitOffset
}
```

The existing logic resolves to a blockIndex + lineIndex. For split rows,
the lineIndex is the same row — the difference is which portion of the
cell content is visible. The character offset calculation happens inside
the cell content lines, which are addressed by the table renderer.

For now, clicks on split rows can resolve to the row's block position.
Precise within-cell click resolution is handled by the table cell click
path in `text-editor.ts`.

- [ ] **Step 2: Update `findPageForPosition`**

When a cursor is inside a split row, `findPageForPosition` must return
the correct page fragment. Currently it matches `blockIndex + lineIndex`:

```typescript
for (const page of paginatedLayout.pages) {
  for (const pl of page.lines) {
    if (pl.blockIndex === blockIndex && pl.lineIndex === targetLineIndex) {
      return { pageIndex: page.pageIndex, pageLine: pl };
    }
  }
}
```

With split rows, multiple PageLines share the same blockIndex + lineIndex.
We need to check which fragment contains the cursor's Y position:

```typescript
// For table blocks with split rows, check if the cursor's cell-local Y
// falls within this fragment's [rowSplitOffset, rowSplitOffset + rowSplitHeight)
```

- [ ] **Step 3: Run tests**

Run: `cd packages/docs && pnpm vitest run`
Expected: All pass.

- [ ] **Step 4: Commit**

```
git add packages/docs/src/view/pagination.ts
git commit -m "Update coordinate mapping for split table row fragments"
```

---

### Task 6: Arrow navigation across split row boundaries

Update `moveVertical` in `text-editor.ts` so that Arrow Up/Down
crosses split row fragment boundaries correctly.

**Files:**
- Modify: `packages/docs/src/view/text-editor.ts` (moveVertical)

- [ ] **Step 1: Handle split row in moveVertical page boundary logic**

The existing cross-page logic in `moveVertical` (line ~3195) already
handles page boundary jumps. Split rows add one case: the cursor is at
the last visible line of a fragment and presses Down — it should move to
the first visible line of the next fragment (same row, next page).

This is naturally handled by `paginatedPixelToPosition` if the coordinate
mapping is correct (Task 5). The target Y calculation lands on the next
page's fragment, and the position resolver returns the correct offset.

Verify this works by testing in the browser. If additional logic is
needed, add a check in `moveVertical`:

```typescript
// After computing crossPageResult, if it lands on the same row
// with a different rowSplitOffset, accept it as a valid move.
```

- [ ] **Step 2: Browser test**

Place cursor at the last line of a split row fragment. Press Arrow Down.
Verify cursor moves to the first line of the next fragment (next page).
Press Arrow Up from there — verify it returns to the previous fragment.

- [ ] **Step 3: Commit**

```
git add packages/docs/src/view/text-editor.ts
git commit -m "Handle arrow navigation across split row fragments"
```

---

### Task 7: Recursive nested table splitting

Extend `getCellContentBreakpoints` to recurse into nested tables,
and verify the full pipeline handles nested table row splitting.

**Files:**
- Modify: `packages/docs/src/view/table-layout.ts` (getCellContentBreakpoints)
- Test: `packages/docs/test/view/table-row-split.test.ts`

- [ ] **Step 1: Write failing test for nested table splitting**

```typescript
describe('nested table row splitting', () => {
  it('splits a row containing a nested table across pages', () => {
    // Create a table with one row containing a nested table
    // The nested table has many rows that exceed page height
    const nestedTable: Block = {
      id: 'nested',
      type: 'table',
      inlines: [],
      style: {},
      tableData: {
        columnWidths: [1],
        rows: Array.from({ length: 30 }, (_, i) => ({
          cells: [{
            blocks: [{ id: `np${i}`, type: 'paragraph' as const, inlines: [{ text: `Nested ${i}` }], style: {} }],
            colSpan: 1, rowSpan: 1,
          }],
        })),
      },
    };

    const outerTable: Block = {
      id: 'outer',
      type: 'table',
      inlines: [],
      style: {},
      tableData: {
        columnWidths: [1],
        rows: [{
          cells: [{
            blocks: [nestedTable],
            colSpan: 1, rowSpan: 1,
          }],
        }],
      },
    };

    const ctx = createMockContext();
    const pageSetup = resolvePageSetup(undefined);
    const dims = getEffectiveDimensions(pageSetup);
    const contentWidth = dims.width - pageSetup.margins.left - pageSetup.margins.right;
    const layout = computeLayout([outerTable], ctx, contentWidth).layout;
    const paginated = paginateLayout(layout, pageSetup);

    // Should span multiple pages
    expect(paginated.pages.length).toBeGreaterThanOrEqual(2);
    // Each page should have content (no empty pages)
    for (const page of paginated.pages) {
      expect(page.lines.length).toBeGreaterThan(0);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/docs && pnpm vitest run test/view/table-row-split.test.ts`
Expected: FAIL — nested table row not split (breakpoints don't recurse).

- [ ] **Step 3: Update `getCellContentBreakpoints` for recursion**

When a cell line has `nestedTable`, recurse into the nested table's
rows to produce breakpoints:

```typescript
export function getCellContentBreakpoints(
  layout: LayoutTable,
  rowIndex: number,
): number[] {
  const padding = DEFAULT_CELL_PADDING;
  const cells = layout.cells[rowIndex];
  if (!cells || cells.length === 0) return [];

  const perCell: number[][] = [];
  for (let c = 0; c < cells.length; c++) {
    const cell = cells[c];
    if (cell.merged) continue;
    const breaks: number[] = [];
    let y = padding;
    for (const line of cell.lines) {
      if (line.nestedTable) {
        // Recurse: each nested row boundary is a breakpoint
        const nt = line.nestedTable;
        for (let nr = 0; nr < nt.rowHeights.length; nr++) {
          // Recursively get breakpoints within the nested row
          const nestedBPs = getCellContentBreakpoints(nt, nr);
          for (const nbp of nestedBPs) {
            breaks.push(y + nt.rowYOffsets[nr] + nbp);
          }
          // The end of each nested row is also a breakpoint
          y_end = y + nt.rowYOffsets[nr] + nt.rowHeights[nr];
          breaks.push(y_end);
        }
        y += line.height;
      } else {
        y += line.height;
        breaks.push(y);
      }
    }
    perCell.push(breaks);
  }

  if (perCell.length === 0) return [];

  // Use union of all breakpoints (not strict intersection) for flexibility
  // then filter to heights where splitting is safe for all cells
  const allBreaks = new Set<number>();
  for (const cellBreaks of perCell) {
    for (const b of cellBreaks) allBreaks.add(b);
  }
  const sorted = [...allBreaks].sort((a, b) => a - b);

  // For each candidate, verify it doesn't cut an atomic unit in any cell
  return sorted.filter(h => {
    return perCell.every(cellBreaks => {
      // h must be at or between breakpoints of this cell
      return cellBreaks.some(cb => cb >= h) || h >= cellBreaks[cellBreaks.length - 1];
    });
  });
}
```

- [ ] **Step 4: Run tests**

Run: `cd packages/docs && pnpm vitest run test/view/table-row-split.test.ts`
Expected: PASS

- [ ] **Step 5: Run full test suite**

Run: `pnpm verify:fast`
Expected: All pass.

- [ ] **Step 6: Commit**

```
git add packages/docs/src/view/table-layout.ts packages/docs/test/view/table-row-split.test.ts
git commit -m "Recurse into nested tables for row split breakpoints"
```

---

### Task 8: rowSpan cell splitting

Handle merged cells (rowSpan > 1) that straddle a page split.

**Files:**
- Modify: `packages/docs/src/view/pagination.ts`
- Modify: `packages/docs/src/view/table-renderer.ts`
- Test: `packages/docs/test/view/table-row-split.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
describe('rowSpan cell splitting', () => {
  it('splits a row with rowSpan cells across pages', () => {
    // Create a 2-column table where column 1 has rowSpan=2
    // and enough content to exceed page height
    const tableBlock: Block = {
      id: 'merged-table',
      type: 'table',
      inlines: [],
      style: {},
      tableData: {
        columnWidths: [0.5, 0.5],
        rows: [
          {
            cells: [
              {
                blocks: Array.from({ length: 40 }, (_, i) => ({
                  id: `m${i}`, type: 'paragraph' as const,
                  inlines: [{ text: `Merged line ${i}` }], style: {},
                })),
                colSpan: 1, rowSpan: 2,
              },
              {
                blocks: [{ id: 'r0c1', type: 'paragraph' as const, inlines: [{ text: 'Row 0 Col 1' }], style: {} }],
                colSpan: 1, rowSpan: 1,
              },
            ],
          },
          {
            cells: [
              { blocks: [], colSpan: 0, rowSpan: 0 }, // covered by merge
              {
                blocks: [{ id: 'r1c1', type: 'paragraph' as const, inlines: [{ text: 'Row 1 Col 1' }], style: {} }],
                colSpan: 1, rowSpan: 1,
              },
            ],
          },
        ],
      },
    };

    const ctx = createMockContext();
    const pageSetup = resolvePageSetup(undefined);
    const dims = getEffectiveDimensions(pageSetup);
    const contentWidth = dims.width - pageSetup.margins.left - pageSetup.margins.right;
    const layout = computeLayout([tableBlock], ctx, contentWidth).layout;
    const paginated = paginateLayout(layout, pageSetup);

    expect(paginated.pages.length).toBeGreaterThanOrEqual(2);
  });
});
```

- [ ] **Step 2: Implement rowSpan-aware breakpoint calculation**

In `getCellContentBreakpoints`, when computing breakpoints for a row,
include rowSpan cells that START in earlier rows but extend through this
row. Their content is distributed via `computeMergedCellLineLayouts`
and must be accounted for in the breakpoint calculation.

- [ ] **Step 3: Update renderer for merged cell fragments**

The existing `computeMergedCellLineLayouts()` in `table-renderer.ts`
already handles distributing merged cell content across rows. For split
rows, the renderer uses the same logic — the clip rect ensures only
the visible portion of the merged cell is shown on each page.

- [ ] **Step 4: Run tests**

Run: `cd packages/docs && pnpm vitest run test/view/table-row-split.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```
git add packages/docs/src/view/pagination.ts packages/docs/src/view/table-layout.ts packages/docs/src/view/table-renderer.ts packages/docs/test/view/table-row-split.test.ts
git commit -m "Handle rowSpan cells in table row splitting"
```

---

### Task 9: End-to-end browser verification and cleanup

**Files:**
- All modified files

- [ ] **Step 1: `pnpm verify:fast`**

Run: `pnpm verify:fast`
Expected: All pass.

- [ ] **Step 2: Browser test — shared document**

Open `http://localhost:5173/shared/50832333-3bc2-4eff-abd1-adb45fcc582c`
and verify:
- "프로젝트 소개" → "프로젝트 개요" transition: row splits across pages,
  no large blank space, content not clipped
- "별첨1-4" area: tall nested tables split correctly
- Arrow Up/Down across split boundaries works
- Click in split row places cursor correctly
- Selection across split boundary renders on both pages

- [ ] **Step 3: Remove any debug logging**

Search for and remove any `console.log` statements added during
development.

- [ ] **Step 4: Final commit**

```
git add -A
git commit -m "Table row splitting: end-to-end verification and cleanup"
```
