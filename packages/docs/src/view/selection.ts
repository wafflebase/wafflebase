import type { DocPosition, DocRange, TableCellRange } from '../model/types.js';
import { getBlockTextLength } from '../model/types.js';
import type { DocumentLayout, LayoutLine } from './layout.js';
import type { PaginatedLayout } from './pagination.js';
import { findPageForPosition, getPageYOffset, getPageXOffset } from './pagination.js';
import { resolvePositionPixel } from './peer-cursor.js';
import { buildFont, Theme } from './theme.js';

// --- Free helpers (used by both Selection class and computeSelectionRects) ---

export interface NormalizedRange {
  start: DocPosition;
  end: DocPosition;
  tableCellRange?: TableCellRange;
}

function normalizeCellRange(cr: TableCellRange): TableCellRange {
  const minRow = Math.min(cr.start.rowIndex, cr.end.rowIndex);
  const maxRow = Math.max(cr.start.rowIndex, cr.end.rowIndex);
  const minCol = Math.min(cr.start.colIndex, cr.end.colIndex);
  const maxCol = Math.max(cr.start.colIndex, cr.end.colIndex);
  return { blockId: cr.blockId, start: { rowIndex: minRow, colIndex: minCol }, end: { rowIndex: maxRow, colIndex: maxCol } };
}

function normalizeRange(
  range: DocRange,
  layout: DocumentLayout,
): NormalizedRange | null {
  // Cell-range mode: tableCellRange is set
  if (range.tableCellRange) {
    return {
      start: range.anchor,
      end: range.focus,
      tableCellRange: normalizeCellRange(range.tableCellRange),
    };
  }

  // Cell-aware selection: check before top-level index lookup since cell
  // block IDs are not in layout.blocks (they live inside table blocks).
  const anchorCellInfo = layout.blockParentMap.get(range.anchor.blockId);
  const focusCellInfo = layout.blockParentMap.get(range.focus.blockId);


  const anchorIdx = layout.blocks.findIndex(
    (lb) => lb.block.id === (anchorCellInfo?.tableBlockId ?? range.anchor.blockId),
  );
  const focusIdx = layout.blocks.findIndex(
    (lb) => lb.block.id === (focusCellInfo?.tableBlockId ?? range.focus.blockId),
  );
  if (anchorIdx === -1 || focusIdx === -1) return null;
  if (anchorCellInfo || focusCellInfo) {
    // Both must be in the same cell for a valid selection
    if (anchorCellInfo && focusCellInfo &&
        anchorCellInfo.tableBlockId === focusCellInfo.tableBlockId &&
        anchorCellInfo.rowIndex === focusCellInfo.rowIndex &&
        anchorCellInfo.colIndex === focusCellInfo.colIndex) {
      // Find cell block indices for ordering
      const tableBlock = layout.blocks.find((b) => b.block.id === anchorCellInfo.tableBlockId);
      const cell = tableBlock?.block.tableData?.rows[anchorCellInfo.rowIndex]?.cells[anchorCellInfo.colIndex];
      const aCbi = cell ? cell.blocks.findIndex((b) => b.id === range.anchor.blockId) : 0;
      const fCbi = cell ? cell.blocks.findIndex((b) => b.id === range.focus.blockId) : 0;
      if (aCbi < fCbi || (aCbi === fCbi && range.anchor.offset <= range.focus.offset)) {
        return { start: range.anchor, end: range.focus };
      }
      return { start: range.focus, end: range.anchor };
    }
    // Mixed or cross-cell — no valid selection
    return null;
  }

  if (
    anchorIdx < focusIdx ||
    (anchorIdx === focusIdx && range.anchor.offset <= range.focus.offset)
  ) {
    return { start: range.anchor, end: range.focus };
  }
  return { start: range.focus, end: range.anchor };
}

function positionToPagePixel(
  paginatedLayout: PaginatedLayout,
  layout: DocumentLayout,
  ctx: CanvasRenderingContext2D,
  canvasWidth: number,
  blockId: string,
  offset: number,
): { x: number; y: number; height: number } | undefined {
  const found = findPageForPosition(paginatedLayout, blockId, offset, layout);
  if (!found) return undefined;

  const { pageIndex, pageLine } = found;
  const pageX = getPageXOffset(paginatedLayout, canvasWidth);
  const pageY = getPageYOffset(paginatedLayout, pageIndex);
  const lb = layout.blocks[pageLine.blockIndex];

  let charsBeforeLine = 0;
  for (let li = 0; li < pageLine.lineIndex; li++) {
    for (const r of lb.lines[li].runs) {
      charsBeforeLine += r.charEnd - r.charStart;
    }
  }
  const lineOffset = offset - charsBeforeLine;

  let charCount = 0;
  for (const run of pageLine.line.runs) {
    const runLength = run.charEnd - run.charStart;
    if (lineOffset >= charCount && lineOffset <= charCount + runLength) {
      const localOff = lineOffset - charCount;
      const isSuperOrSub = run.inline.style.superscript || run.inline.style.subscript;
      const measureFontSize = isSuperOrSub
        ? (run.inline.style.fontSize ?? Theme.defaultFontSize) * 0.6
        : run.inline.style.fontSize;
      ctx.font = buildFont(
        measureFontSize, run.inline.style.fontFamily,
        run.inline.style.bold, run.inline.style.italic,
      );
      const x = pageX + pageLine.x + run.x + ctx.measureText(run.text.slice(0, localOff)).width;
      return { x, y: pageY + pageLine.y, height: pageLine.line.height };
    }
    charCount += runLength;
  }

  const lastRun = pageLine.line.runs[pageLine.line.runs.length - 1];
  if (lastRun) {
    return {
      x: pageX + pageLine.x + lastRun.x + lastRun.width,
      y: pageY + pageLine.y, height: pageLine.line.height,
    };
  }
  return { x: pageX + pageLine.x, y: pageY + pageLine.y, height: 24 };
}

function getLineEndX(line: LayoutLine, lineBaseX: number): number {
  if (line.runs.length === 0) return lineBaseX;
  const last = line.runs[line.runs.length - 1];
  return lineBaseX + last.x + last.width;
}

function getLineStartX(line: LayoutLine, lineBaseX: number): number {
  if (line.runs.length === 0) return lineBaseX;
  const first = line.runs[0];
  return lineBaseX + first.x;
}

function buildRects(
  start: DocPosition,
  end: DocPosition,
  paginatedLayout: PaginatedLayout,
  layout: DocumentLayout,
  ctx: CanvasRenderingContext2D,
  canvasWidth: number,
): Array<{ x: number; y: number; width: number; height: number }> {
  // Cell-internal selection
  const startCellInfo = layout.blockParentMap.get(start.blockId);
  const endCellInfo = layout.blockParentMap.get(end.blockId);
  if (startCellInfo && endCellInfo) {
    const startPixel = resolvePositionPixel(start, 'forward', paginatedLayout, layout, ctx, canvasWidth);
    const endPixel = resolvePositionPixel(end, 'backward', paginatedLayout, layout, ctx, canvasWidth);
    if (!startPixel || !endPixel) return [];

    if (startPixel.y === endPixel.y) {
      // Same visual line — single rect
      return [{
        x: startPixel.x,
        y: startPixel.y,
        width: endPixel.x - startPixel.x,
        height: startPixel.height,
      }];
    }

    // Multi-line cell selection: find cell bounds for full-width lines
    const lb = layout.blocks.find((b) => b.block.id === startCellInfo.tableBlockId);
    const tl = lb?.layoutTable;
    if (!tl) {
      // Fallback: rect from start to end
      return [{
        x: startPixel.x,
        y: startPixel.y,
        width: endPixel.x - startPixel.x,
        height: endPixel.y + endPixel.height - startPixel.y,
      }];
    }
    const { rowIndex, colIndex } = startCellInfo;
    const cellPadding = lb!.block.tableData?.rows[rowIndex]?.cells[colIndex]?.style.padding ?? 4;
    const cellLeftX = startPixel.x - (startPixel.x - (getPageXOffset(paginatedLayout, canvasWidth) + paginatedLayout.pageSetup.margins.left + tl.columnXOffsets[colIndex] + cellPadding));
    const cellRightX = getPageXOffset(paginatedLayout, canvasWidth) + paginatedLayout.pageSetup.margins.left + tl.columnXOffsets[colIndex] + tl.columnPixelWidths[colIndex] - cellPadding;

    const cellRects: Array<{ x: number; y: number; width: number; height: number }> = [];
    // First line: from start to cell right edge
    cellRects.push({
      x: startPixel.x,
      y: startPixel.y,
      width: cellRightX - startPixel.x,
      height: startPixel.height,
    });
    // Middle lines: full cell width
    let midY = startPixel.y + startPixel.height;
    while (midY < endPixel.y) {
      cellRects.push({
        x: cellLeftX,
        y: midY,
        width: cellRightX - cellLeftX,
        height: startPixel.height, // approximate line height
      });
      midY += startPixel.height;
    }
    // Last line: from cell left edge to end
    cellRects.push({
      x: cellLeftX,
      y: endPixel.y,
      width: endPixel.x - cellLeftX,
      height: endPixel.height,
    });
    return cellRects;
  }

  const rects: Array<{ x: number; y: number; width: number; height: number }> = [];

  const startBlockIdx = layout.blocks.findIndex(
    (lb) => lb.block.id === start.blockId,
  );
  const endBlockIdx = layout.blocks.findIndex(
    (lb) => lb.block.id === end.blockId,
  );
  if (startBlockIdx === -1 || endBlockIdx === -1) return [];

  for (let bi = startBlockIdx; bi <= endBlockIdx; bi++) {
    const lb = layout.blocks[bi];

    // Table block within selection: highlight all cells
    if (lb.block.type === 'table' && lb.block.tableData && lb.layoutTable) {
      const td = lb.block.tableData;
      const fullRange: TableCellRange = {
        blockId: lb.block.id,
        start: { rowIndex: 0, colIndex: 0 },
        end: { rowIndex: td.rows.length - 1, colIndex: td.columnWidths.length - 1 },
      };
      rects.push(...buildCellRangeRects(fullRange, paginatedLayout, layout, canvasWidth));
      continue;
    }

    const blockStart = bi === startBlockIdx ? start.offset : 0;
    const blockEnd =
      bi === endBlockIdx ? end.offset : getBlockTextLength(lb.block);

    if (blockStart >= blockEnd) continue;

    const startPixel = positionToPagePixel(
      paginatedLayout, layout, ctx, canvasWidth, lb.block.id, blockStart,
    );
    const endPixel = positionToPagePixel(
      paginatedLayout, layout, ctx, canvasWidth, lb.block.id, blockEnd,
    );

    if (!startPixel || !endPixel) continue;

    if (startPixel.y === endPixel.y) {
      rects.push({
        x: startPixel.x,
        y: startPixel.y,
        width: endPixel.x - startPixel.x,
        height: startPixel.height,
      });
    } else {
      const pageX = getPageXOffset(paginatedLayout, canvasWidth);
      const startFound = findPageForPosition(paginatedLayout, lb.block.id, blockStart, layout);
      const endFound = findPageForPosition(paginatedLayout, lb.block.id, blockEnd, layout);
      if (!startFound || !endFound) continue;

      const firstLineEnd = getLineEndX(startFound.pageLine.line, pageX + startFound.pageLine.x);
      rects.push({
        x: startPixel.x,
        y: startPixel.y,
        width: firstLineEnd - startPixel.x,
        height: startPixel.height,
      });

      for (const page of paginatedLayout.pages) {
        const pageY = getPageYOffset(paginatedLayout, page.pageIndex);
        for (const pl of page.lines) {
          if (pl.blockIndex !== bi) continue;
          const lineY = pageY + pl.y;
          if (lineY <= startPixel.y || lineY >= endPixel.y) continue;
          const lineStartX = getLineStartX(pl.line, pageX + pl.x);
          const lineEndX = getLineEndX(pl.line, pageX + pl.x);
          rects.push({
            x: lineStartX,
            y: lineY,
            width: lineEndX - lineStartX,
            height: pl.line.height,
          });
        }
      }

      const lastLineStart = getLineStartX(endFound.pageLine.line, pageX + endFound.pageLine.x);
      rects.push({
        x: lastLineStart,
        y: endPixel.y,
        width: endPixel.x - lastLineStart,
        height: endPixel.height,
      });
    }
  }

  return rects;
}

// --- Exported free function for peer selection rendering ---

/**
 * Compute highlight rectangles for an arbitrary DocRange.
 * Used for rendering remote peer selections.
 */
export function computeSelectionRects(
  range: DocRange,
  paginatedLayout: PaginatedLayout,
  layout: DocumentLayout,
  ctx: CanvasRenderingContext2D,
  canvasWidth: number,
): Array<{ x: number; y: number; width: number; height: number }> {
  const normalized = normalizeRange(range, layout);
  if (!normalized) return [];

  // Cell-range mode: highlight entire cells
  if (normalized.tableCellRange) {
    return buildCellRangeRects(normalized.tableCellRange, paginatedLayout, layout, canvasWidth);
  }

  if (normalized.start.blockId === normalized.end.blockId &&
      normalized.start.offset === normalized.end.offset) return [];
  return buildRects(normalized.start, normalized.end, paginatedLayout, layout, ctx, canvasWidth);
}

/**
 * Build highlight rectangles for a cell-range selection.
 */
function buildCellRangeRects(
  cellRange: TableCellRange,
  paginatedLayout: PaginatedLayout,
  layout: DocumentLayout,
  canvasWidth: number,
): Array<{ x: number; y: number; width: number; height: number }> {
  const lb = layout.blocks.find((b) => b.block.id === cellRange.blockId);
  if (!lb?.layoutTable) return [];
  const tl = lb.layoutTable;

  const blockIndex = layout.blocks.indexOf(lb);
  const pageX = getPageXOffset(paginatedLayout, canvasWidth);
  const { margins } = paginatedLayout.pageSetup;

  // Find the page Y offset for this table's first row
  let tablePageY = 0;
  let tableRowBaseY = 0;
  let foundTablePage = false;
  for (const page of paginatedLayout.pages) {
    for (const pl of page.lines) {
      if (pl.blockIndex === blockIndex && pl.lineIndex === 0) {
        tablePageY = getPageYOffset(paginatedLayout, page.pageIndex) + pl.y;
        tableRowBaseY = tl.rowYOffsets[0];
        foundTablePage = true;
        break;
      }
    }
    if (foundTablePage) break;
  }
  const tableOriginY = tablePageY - tableRowBaseY;

  const { start, end } = cellRange;
  const rects: Array<{ x: number; y: number; width: number; height: number }> = [];

  for (let r = start.rowIndex; r <= end.rowIndex; r++) {
    for (let c = start.colIndex; c <= end.colIndex; c++) {
      const cell = tl.cells[r]?.[c];
      if (!cell || cell.merged) continue;
      rects.push({
        x: pageX + margins.left + tl.columnXOffsets[c],
        y: tableOriginY + tl.rowYOffsets[r],
        width: tl.columnPixelWidths[c],
        height: tl.rowHeights[r],
      });
    }
  }
  return rects;
}

// --- Selection class (local selection state) ---

/**
 * Text selection state and highlight rectangle computation.
 */
export class Selection {
  range: DocRange | null = null;

  setRange(range: DocRange | null): void {
    this.range = range;
  }

  hasSelection(): boolean {
    if (!this.range) return false;
    if (this.range.tableCellRange) return true;
    return (
      this.range.anchor.blockId !== this.range.focus.blockId ||
      this.range.anchor.offset !== this.range.focus.offset
    );
  }

  getNormalizedRange(
    layout: DocumentLayout,
  ): NormalizedRange | null {
    if (!this.range || !this.hasSelection()) return null;
    return normalizeRange(this.range, layout);
  }

  getSelectionRects(
    paginatedLayout: PaginatedLayout,
    layout: DocumentLayout,
    ctx: CanvasRenderingContext2D,
    canvasWidth: number,
  ): Array<{ x: number; y: number; width: number; height: number }> {
    if (!this.range || !this.hasSelection()) return [];
    return computeSelectionRects(this.range, paginatedLayout, layout, ctx, canvasWidth);
  }

  getSelectedText(layout: DocumentLayout): string {
    const normalized = this.getNormalizedRange(layout);
    if (!normalized) return '';

    // Cell-range selection: tab-separated columns, newline-separated rows
    if (normalized.tableCellRange) {
      const cr = normalized.tableCellRange;
      const lb = layout.blocks.find((b) => b.block.id === cr.blockId);
      if (!lb?.block.tableData) return '';
      const td = lb.block.tableData;
      const rows: string[] = [];
      for (let r = cr.start.rowIndex; r <= cr.end.rowIndex; r++) {
        const cols: string[] = [];
        for (let c = cr.start.colIndex; c <= cr.end.colIndex; c++) {
          const cell = td.rows[r]?.cells[c];
          if (cell) {
            cols.push(cell.blocks.flatMap(b => b.inlines).map(i => i.text).join(''));
          } else {
            cols.push('');
          }
        }
        rows.push(cols.join('\t'));
      }
      return rows.join('\n');
    }

    const { start, end } = normalized;

    // Cell-internal selection
    const startCellInfo = layout.blockParentMap.get(start.blockId);
    const endCellInfo = layout.blockParentMap.get(end.blockId);
    if (startCellInfo && endCellInfo) {
      const lb = layout.blocks.find((b) => b.block.id === startCellInfo.tableBlockId);
      if (!lb?.block.tableData) return '';
      const cell = lb.block.tableData.rows[startCellInfo.rowIndex]
        ?.cells[startCellInfo.colIndex];
      if (!cell) return '';
      const startCbi = cell.blocks.findIndex((b) => b.id === start.blockId);
      const endCbi = cell.blocks.findIndex((b) => b.id === end.blockId);

      if (startCbi === endCbi) {
        const targetBlock = cell.blocks[startCbi >= 0 ? startCbi : 0];
        if (!targetBlock) return '';
        const blockText = targetBlock.inlines.map((i) => i.text).join('');
        return blockText.slice(start.offset, end.offset);
      }

      // Cross-block cell selection
      const effectiveStart = startCbi >= 0 ? startCbi : 0;
      const effectiveEnd = endCbi >= 0 ? endCbi : 0;
      const texts: string[] = [];
      for (let bi = effectiveStart; bi <= effectiveEnd; bi++) {
        const blk = cell.blocks[bi];
        if (!blk) continue;
        const fullText = blk.inlines.map((i) => i.text).join('');
        const s = bi === effectiveStart ? start.offset : 0;
        const e = bi === effectiveEnd ? end.offset : fullText.length;
        texts.push(fullText.slice(s, e));
      }
      return texts.join('\n');
    }

    const texts: string[] = [];

    const startBlockIdx = layout.blocks.findIndex(
      (lb) => lb.block.id === start.blockId,
    );
    const endBlockIdx = layout.blocks.findIndex(
      (lb) => lb.block.id === end.blockId,
    );

    if (startBlockIdx === -1 || endBlockIdx === -1) return '';

    for (let bi = startBlockIdx; bi <= endBlockIdx; bi++) {
      const lb = layout.blocks[bi];
      const fullText = lb.block.inlines.map((i) => i.text).join('');
      const blockStart = bi === startBlockIdx ? start.offset : 0;
      const blockEnd =
        bi === endBlockIdx ? end.offset : fullText.length;
      texts.push(fullText.slice(blockStart, blockEnd));
    }

    return texts.join('\n');
  }
}
