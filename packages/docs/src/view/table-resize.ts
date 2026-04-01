import type { LayoutTable } from './table-layout.js';

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

export function detectTableBorder(
  layout: LayoutTable,
  localX: number,
  localY: number,
): BorderHit | null {
  const { columnXOffsets, columnPixelWidths, rowYOffsets, rowHeights } = layout;
  const numCols = columnPixelWidths.length;
  const numRows = rowHeights.length;

  // Check column borders (skip first left edge and last right edge)
  for (let c = 0; c < numCols - 1; c++) {
    const borderX = columnXOffsets[c] + columnPixelWidths[c];
    if (Math.abs(localX - borderX) <= BORDER_THRESHOLD) {
      return { type: 'column', index: c };
    }
  }

  // Check row borders (skip first top edge; include last bottom edge)
  for (let r = 0; r < numRows; r++) {
    const borderY = rowYOffsets[r] + rowHeights[r];
    if (Math.abs(localY - borderY) <= BORDER_THRESHOLD) {
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
    return {
      type: 'column',
      tableBlockId,
      index: hit.index,
      startPixel: mousePixel,
      currentPixel: mousePixel,
      minPixel: leftColStart + MIN_COLUMN_WIDTH,
      maxPixel: rightColEnd - MIN_COLUMN_WIDTH,
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
