import type { LayoutTable } from './table-layout.js';
import type { TableData } from '../model/types.js';
import { findMergeTopLeft } from './selection.js';

const BORDER_THRESHOLD = 4;
const MIN_COLUMN_WIDTH = 30;
const MIN_ROW_HEIGHT = 20;

export interface BorderHit {
  type: 'column' | 'row';
  index: number;
}

export interface BorderDragState {
  type: 'column' | 'row';
  tableBlockId: string;
  index: number;
  startPixel: number;
  currentPixel: number;
  minPixel: number;
  maxPixel: number;
}

/**
 * Return true if the two cell positions belong to the same merged cell.
 * Plain cells have themselves as their own "top-left" so this also returns
 * false for any two different plain cells.
 */
function cellsShareMerge(
  table: TableData,
  r1: number, c1: number,
  r2: number, c2: number,
): boolean {
  const a = findMergeTopLeft(table, r1, c1);
  const b = findMergeTopLeft(table, r2, c2);
  return a.rowIndex === b.rowIndex && a.colIndex === b.colIndex;
}

export function detectTableBorder(
  layout: LayoutTable,
  localX: number,
  localY: number,
  tableData?: TableData,
): BorderHit | null {
  const { columnXOffsets, columnPixelWidths, rowYOffsets, rowHeights } = layout;
  const numCols = columnPixelWidths.length;
  const numRows = rowHeights.length;

  // Locate the row and column the cursor is currently over so we can tell
  // whether a nearby border segment is swallowed by a merged cell.
  let hoverRow = -1;
  for (let r = 0; r < numRows; r++) {
    const top = rowYOffsets[r];
    const bottom = top + rowHeights[r];
    if (localY >= top && localY <= bottom) {
      hoverRow = r;
      break;
    }
  }
  let hoverCol = -1;
  for (let c = 0; c < numCols; c++) {
    const left = columnXOffsets[c];
    const right = left + columnPixelWidths[c];
    if (localX >= left && localX <= right) {
      hoverCol = c;
      break;
    }
  }

  // Check column borders (skip first left edge and last right edge)
  for (let c = 0; c < numCols - 1; c++) {
    const borderX = columnXOffsets[c] + columnPixelWidths[c];
    if (Math.abs(localX - borderX) <= BORDER_THRESHOLD) {
      if (
        tableData &&
        hoverRow >= 0 &&
        cellsShareMerge(tableData, hoverRow, c, hoverRow, c + 1)
      ) {
        continue;
      }
      return { type: 'column', index: c };
    }
  }

  // Check row borders (skip first top edge; include last bottom edge)
  for (let r = 0; r < numRows; r++) {
    const borderY = rowYOffsets[r] + rowHeights[r];
    if (Math.abs(localY - borderY) <= BORDER_THRESHOLD) {
      if (
        tableData &&
        hoverCol >= 0 &&
        r + 1 < numRows &&
        cellsShareMerge(tableData, r, hoverCol, r + 1, hoverCol)
      ) {
        continue;
      }
      return { type: 'row', index: r };
    }
  }

  return null;
}

export function createDragState(
  hit: BorderHit,
  tableBlockId: string,
  layout: LayoutTable,
  mousePixel: number,
  tableOriginPixel: number,
): BorderDragState {
  const { columnXOffsets, columnPixelWidths, rowYOffsets } = layout;

  if (hit.type === 'column') {
    const leftColStart = tableOriginPixel + columnXOffsets[hit.index];
    const rightColEnd =
      tableOriginPixel + columnXOffsets[hit.index + 1] + columnPixelWidths[hit.index + 1];
    const minPixel = leftColStart + MIN_COLUMN_WIDTH;
    const maxPixel = rightColEnd - MIN_COLUMN_WIDTH;
    // If adjacent columns are too narrow, collapse to no-op drag
    const safeMin = minPixel <= maxPixel ? minPixel : mousePixel;
    const safeMax = minPixel <= maxPixel ? maxPixel : mousePixel;
    return {
      type: 'column',
      tableBlockId,
      index: hit.index,
      startPixel: mousePixel,
      currentPixel: mousePixel,
      minPixel: safeMin,
      maxPixel: safeMax,
    };
  } else {
    const rowStart = tableOriginPixel + rowYOffsets[hit.index];
    return {
      type: 'row',
      tableBlockId,
      index: hit.index,
      startPixel: mousePixel,
      currentPixel: mousePixel,
      minPixel: rowStart + MIN_ROW_HEIGHT,
      maxPixel: Number.MAX_SAFE_INTEGER,
    };
  }
}

export { MIN_COLUMN_WIDTH, MIN_ROW_HEIGHT, BORDER_THRESHOLD };
