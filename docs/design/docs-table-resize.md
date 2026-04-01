---
title: docs-table-resize
target-version: 0.3.2
---

# Docs Table Column & Row Resize

## Summary

Add column and row resize handles to Docs tables via cell border drag
interaction (Google Docs style). Users hover near a cell border, the
cursor changes to `col-resize` or `row-resize`, and drag to adjust
the size. A guideline is shown during drag; the resize is applied on
mouse-up.

## Goals

- Column resize by dragging vertical cell borders
- Row resize by dragging horizontal cell borders
- Guideline visual feedback during drag (no live re-layout)
- Adjacent-column resize: only the two columns sharing the border change
- Minimum size constraints (30px column width, 20px row height)

## Non-Goals

- Table-level resize (scaling entire table width)
- Pixel-based column width storage (keep proportional ratios)
- Live re-layout during drag (guideline only, apply on mouse-up)
- Ruler or external resize handles outside the table

## Data Model Changes

### TableData

Add optional `rowHeights` array:

```typescript
interface TableData {
  rows: TableRow[];
  columnWidths: number[];  // Proportional ratios (0-1), sum = 1.0
  rowHeights?: number[];   // User-specified minimum heights in px
}
```

- `rowHeights[i]` is the user-specified minimum height for row `i`.
  If the content height exceeds this value, content height is used.
- When `rowHeights` is `undefined` or a specific entry is `undefined`,
  the row uses content-based auto height (existing behavior).
- Row insert/delete operations must splice `rowHeights` in sync.

### Column Width Model

No change. `columnWidths` remains as proportional ratios summing to 1.0.
Pixel widths are computed at layout time as `ratio * contentWidth`.

## Doc API

### New Methods

```typescript
class Doc {
  /**
   * Resize adjacent columns by adjusting their ratios.
   * Only col[colIndex] and col[colIndex + 1] change.
   * Total ratio sum remains 1.0.
   */
  resizeColumn(
    blockId: string,
    colIndex: number,
    leftRatio: number,
    rightRatio: number,
  ): void;

  /**
   * Set a row's minimum height in pixels.
   */
  setRowHeight(
    blockId: string,
    rowIndex: number,
    height: number,
  ): void;
}
```

`resizeColumn()` differs from existing `setColumnWidth()` which
distributes remaining space equally across all other columns.
`resizeColumn()` only touches the two adjacent columns.

### Existing `setColumnWidth()` — Unchanged

Kept for programmatic use (e.g., equal-distribute from context menu).
`resizeColumn()` is the drag-specific method.

## Border Detection

### Hit Zone

On `mousemove` within a table block, compute distance from mouse
position to each column/row border:

- **Column borders**: vertical lines at `columnXOffsets[c]` for
  `c = 1..numCols-1` (skip left edge of first column, skip right
  edge of last column — no adjacent column to resize)
- **Row borders**: horizontal lines at `rowYOffsets[r]` for
  `r = 1..numRows` (skip top edge of first row; include bottom edge
  of last row for height adjustment)
- **Detection threshold**: 4px from the border line
- **Priority**: When both column and row borders are within threshold
  (intersection), column resize takes priority

### Cursor Changes

| State | Cursor |
|-------|--------|
| Near vertical border | `col-resize` |
| Near horizontal border | `row-resize` |
| Neither | Default (text cursor or pointer) |

## Drag State

### Interface

```typescript
interface BorderDragState {
  type: 'column' | 'row';
  tableBlockId: string;
  index: number;        // Border's left/top column/row index
  startPixel: number;   // Mouse X or Y at mousedown
  currentPixel: number; // Current mouse X or Y during drag
  minPixel: number;     // Lower bound (min size constraint)
  maxPixel: number;     // Upper bound (adjacent min size constraint)
}
```

### Event Flow

1. **mousedown** + border proximity detected:
   - Create `BorderDragState`
   - Suppress cell selection and text editing
   - Compute `minPixel` and `maxPixel` from current layout and
     minimum size constraints

2. **mousemove** (drag active):
   - Update `currentPixel`, clamped to `[minPixel, maxPixel]`
   - Request render (guideline only — no re-layout)

3. **mouseup**:
   - Compute delta from `startPixel` to `currentPixel`
   - For column: convert delta to ratio change
     (`deltaRatio = deltaPx / contentWidth`), call `resizeColumn()`
   - For row: compute new height
     (`newHeight = currentRowHeight + deltaPx`), call `setRowHeight()`
   - Clear `dragState`

### Ratio Calculation (Column)

```text
deltaRatio = (currentPixel - startPixel) / contentWidth

newLeftRatio  = clamp(oldLeftRatio + deltaRatio, minRatio, maxLeftRatio)
newRightRatio = oldLeftRatio + oldRightRatio - newLeftRatio

resizeColumn(blockId, colIndex, newLeftRatio, newRightRatio)
```

Where `minRatio = 30 / contentWidth`.

### Height Calculation (Row)

```text
deltaPx = currentPixel - startPixel
layoutHeight = current computed row height from layout
newHeight = max(layoutHeight + deltaPx, 20)

setRowHeight(blockId, rowIndex, newHeight)
```

Content height is the floor — users cannot shrink below content.

## Guideline Rendering

During drag, render on the Canvas overlay:

- **Column drag**: Vertical dashed line (blue, 1px) from table top
  to table bottom at `currentPixel` X position
- **Row drag**: Horizontal dashed line (blue, 1px) from table left
  to table right at `currentPixel` Y position

Line style: `setLineDash([4, 4])`, color `#4A90D9`, lineWidth 1.

The guideline is drawn in the render pass, not as a separate overlay.
When `dragState` is non-null, the table renderer draws the guideline
after borders.

## Layout Integration

### Row Heights

In `computeTableLayout()`, after computing content-based row heights,
apply user-specified minimums:

```typescript
// After step 5 (MIN_ROW_HEIGHT enforcement)
if (tableData.rowHeights) {
  for (let r = 0; r < numRows; r++) {
    const userHeight = tableData.rowHeights[r];
    if (userHeight !== undefined && userHeight > rowHeights[r]) {
      rowHeights[r] = userHeight;
    }
  }
}
```

### Column Widths

No layout changes needed — existing `ratio * contentWidth` computation
works as-is.

## Edge Cases

### First/Last Borders

- **Left edge of first column**: Not resizable (no left neighbor)
- **Right edge of last column**: Not resizable (no right neighbor)
- **Top edge of first row**: Not resizable
- **Bottom edge of last row**: Resizable (adjusts last row height)

### Merged Cells

Border detection still works on the column/row grid level, not on
individual cell boundaries. A border between two columns is draggable
even if cells spanning that border exist. The merge spans adapt
automatically because layout recomputes after resize.

### Pagination

When a table spans multiple pages, the border detection uses
page-local coordinates. The guideline renders only on the page where
the drag started. The resize applies to the underlying data model,
so all pages re-render correctly.

### Minimum Size Constraints

| Dimension | Minimum | Enforcement |
|-----------|---------|-------------|
| Column width | 30px | `minRatio = 30 / contentWidth`; clamp both columns |
| Row height | 20px (`MIN_ROW_HEIGHT`) | `max(userHeight, MIN_ROW_HEIGHT)` in layout |
| Row height floor | Content height | Users cannot shrink below content-based height |

## File Changes

| File | Change |
|------|--------|
| `packages/docs/src/model/types.ts` | Add `rowHeights?: number[]` to `TableData` |
| `packages/docs/src/model/document.ts` | Add `resizeColumn()`, `setRowHeight()`; update `insertRow()`/`deleteRow()` for `rowHeights` sync |
| `packages/docs/src/view/table-layout.ts` | Apply `rowHeights` minimum in `computeTableLayout()` |
| `packages/docs/src/view/text-editor.ts` | Border detection in `mousemove`, drag state management in `mousedown`/`mousemove`/`mouseup`, guideline trigger |
| `packages/docs/src/view/table-renderer.ts` | Render guideline when `dragState` is active |
| `packages/docs/src/store/memory.ts` | Persist `rowHeights` in store updates |

## Risks and Mitigation

| Risk | Impact | Mitigation |
|------|--------|------------|
| Border detection interferes with cell click | High | 4px threshold is narrow; mousedown near border starts drag, not cell selection |
| Performance on large tables during mousemove | Low | Border detection is O(rows + cols) comparison, no layout recompute |
| rowHeights desync on row insert/delete | Medium | Splice `rowHeights` array in `insertRow()`/`deleteRow()` |
| Pagination complicates coordinate mapping | Medium | Reuse existing page-local coordinate transform from `resolveTableCellClick()` |
| CRDT conflict on concurrent column resize | Low | Both users modify `columnWidths` array; last-write-wins per element is acceptable |
