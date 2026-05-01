// Pure geometry helpers for table layout — shared between the Canvas
// renderer (`table-renderer.ts`) and the PDF painter
// (`export/pdf-table-painter.ts`). Nothing in this module touches a
// CanvasRenderingContext2D or draws — every export is a pure function
// over layout/data structures so both rendering backends can compute
// the same rectangles, row ranges, and merged-cell line placements.

import type { LayoutTable, LayoutTableCell } from './table-layout.js';
import type { LayoutBlock } from './layout.js';
import type { LayoutPage, PageLine } from './pagination.js';
import type { TableData } from '../model/types.js';

/**
 * Per-line placement for a merged cell: which spanned row the line
 * belongs to and the line's absolute Y in table-logical coordinates.
 */
export interface MergedCellLineLayout {
  ownerRow: number;
  runLineY: number;
}

/**
 * Distribute a merged cell's lines across the rows it spans, using a
 * content-flow model: a line occupies the next free slot in the current
 * row; if it does not fit, advance to the next row and start from that
 * row's top padding. This lines up well with a user's expectation that
 * N lines merged into N rows show one line per row, and cleanly answers
 * "which page does this line belong to" even when `rowHeights` have slack
 * (previously the center-in-range heuristic collapsed late lines into
 * an earlier row whenever the rows were taller than the lines).
 *
 * Returned positions are in table-logical Y (relative to the table's
 * top-left). Callers add their page origin to draw or to anchor a cursor.
 * For `rowSpan <= 1` the result matches the old `cellY + padding + line.y`
 * formula so non-merged cells render unchanged.
 */
export function computeMergedCellLineLayouts(
  cellLines: LayoutTableCell['lines'],
  cellTopRow: number,
  rowSpan: number,
  cellPadding: number,
  rowYOffsets: number[],
  rowHeights: number[],
): MergedCellLineLayout[] {
  const numRows = rowYOffsets.length;
  const spanEnd = Math.min(cellTopRow + rowSpan, numRows);
  const result: MergedCellLineLayout[] = [];
  let currentRow = cellTopRow;
  let yInRow = cellPadding;

  for (const line of cellLines) {
    if (
      rowSpan > 1 &&
      currentRow + 1 < spanEnd &&
      yInRow + line.height > rowHeights[currentRow] - cellPadding
    ) {
      currentRow++;
      yInRow = cellPadding;
    }
    result.push({
      ownerRow: currentRow,
      runLineY: rowYOffsets[currentRow] + yInRow,
    });
    yInRow += line.height;
  }
  return result;
}

/**
 * Return the block index that owns the given line index, using the
 * pre-computed `blockBoundaries` array (each entry is the first line
 * index of the corresponding block).
 *
 * Pure function over `blockBoundaries`; safe to call from either
 * the Canvas renderer or the PDF painter when walking a cell's lines.
 */
export function getBlockIndexForLine(
  blockBoundaries: number[],
  lineIndex: number,
): number {
  for (let bi = blockBoundaries.length - 1; bi >= 0; bi--) {
    if (lineIndex >= blockBoundaries[bi]) return bi;
  }
  return 0;
}

/**
 * Compute the row range + origin for a table block rooted at a given
 * PageLine on a page. Used by both the Canvas renderer (background
 * pre-pass and content pass) and the PDF painter so their row-range
 * logic stays in lockstep.
 *
 * - `endRowIndex` extends forward over every consecutive PageLine that
 *   belongs to the same table block on this page (a single page can
 *   host any number of rows from the same table).
 * - `renderStartRow` extends backward over rowSpan owners whose
 *   logical top row started on a previous page — the owner must be
 *   visited even though its PageLine is off-page, so the merged cell
 *   gets drawn on the current page.
 */
export function computeTableRangeForPageLine(
  page: LayoutPage,
  layoutBlock: LayoutBlock,
  pl: PageLine,
  plIndex: number,
): { pageStartRow: number; renderStartRow: number; endRowIndex: number } {
  const pageStartRow = pl.lineIndex;
  let endRowIndex = pageStartRow + 1;
  // Split fragments render only their own row — don't extend to
  // subsequent rows, which would incorrectly include them in the
  // clipped split pass.
  if (pl.rowSplitOffset === undefined) {
    for (let k = plIndex + 1; k < page.lines.length; k++) {
      const nextPl = page.lines[k];
      if (nextPl.blockIndex === pl.blockIndex) {
        // Stop before split fragments — they get their own render pass
        if (nextPl.rowSplitOffset !== undefined) break;
        endRowIndex = nextPl.lineIndex + 1;
      } else {
        break;
      }
    }
  }
  let renderStartRow = pageStartRow;
  const tableData = layoutBlock.block.tableData;
  if (tableData) {
    for (let r = 0; r < pageStartRow; r++) {
      for (let c = 0; c < tableData.rows[r].cells.length; c++) {
        const cell = tableData.rows[r].cells[c];
        const rs = cell.rowSpan ?? 1;
        if (rs > 1 && r + rs > pageStartRow) {
          renderStartRow = Math.min(renderStartRow, r);
        }
      }
    }
  }
  return { pageStartRow, renderStartRow, endRowIndex };
}

/**
 * Compute the table-local rectangle of a cell at `(row, col)` honoring
 * its `colSpan` / `rowSpan`. The returned `{x, y, w, h}` is in
 * table-logical pixels (relative to the table's top-left); callers add
 * their page origin to translate into rendering coordinates. Returns a
 * zero-sized rect if the cell is out of bounds.
 *
 * This mirrors the per-cell math in `renderTableBackgrounds` /
 * `renderTableContent` so both Canvas and PDF backends place borders
 * and backgrounds at byte-identical coordinates.
 */
export function cellOriginPx(
  layoutTable: LayoutTable,
  tableData: TableData,
  row: number,
  col: number,
): { x: number; y: number; w: number; h: number } {
  const numCols = layoutTable.columnPixelWidths.length;
  const numRows = layoutTable.rowHeights.length;
  const cell = tableData.rows[row]?.cells[col];
  const colSpan = cell?.colSpan ?? 1;
  const rowSpan = cell?.rowSpan ?? 1;

  let w = 0;
  for (let s = 0; s < colSpan && col + s < numCols; s++) {
    w += layoutTable.columnPixelWidths[col + s];
  }
  let h = 0;
  for (let s = 0; s < rowSpan && row + s < numRows; s++) {
    h += layoutTable.rowHeights[row + s];
  }
  return {
    x: layoutTable.columnXOffsets[col] ?? 0,
    y: layoutTable.rowYOffsets[row] ?? 0,
    w,
    h,
  };
}

/**
 * True when the cell at `(row, col)` in `layoutTable` is covered by a
 * merge from another cell (i.e. it is not a merge owner and should be
 * skipped during background/border/content passes). Mirrors the
 * `if (layoutCell.merged) continue;` short-circuit used throughout the
 * Canvas renderer.
 */
export function isCellCovered(
  layoutTable: LayoutTable,
  row: number,
  col: number,
): boolean {
  return layoutTable.cells[row]?.[col]?.merged === true;
}
