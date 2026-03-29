import type { DocPosition, DocRange } from '../model/types.js';
import { getBlockTextLength } from '../model/types.js';
import type { DocumentLayout, LayoutLine } from './layout.js';
import type { PaginatedLayout } from './pagination.js';
import { findPageForPosition, getPageYOffset, getPageXOffset } from './pagination.js';
import { resolvePositionPixel } from './peer-cursor.js';
import { buildFont, Theme } from './theme.js';

// --- Free helpers (used by both Selection class and computeSelectionRects) ---

function normalizeRange(
  range: DocRange,
  layout: DocumentLayout,
): { start: DocPosition; end: DocPosition } | null {
  const anchorIdx = layout.blocks.findIndex(
    (lb) => lb.block.id === range.anchor.blockId,
  );
  const focusIdx = layout.blocks.findIndex(
    (lb) => lb.block.id === range.focus.blockId,
  );
  if (anchorIdx === -1 || focusIdx === -1) return null;

  // Cell-aware selection: if either position has cellAddress, handle specially
  if (range.anchor.cellAddress || range.focus.cellAddress) {
    // Both must have cellAddress and be in the same cell for a valid selection
    if (range.anchor.cellAddress && range.focus.cellAddress &&
        range.anchor.blockId === range.focus.blockId &&
        range.anchor.cellAddress.rowIndex === range.focus.cellAddress.rowIndex &&
        range.anchor.cellAddress.colIndex === range.focus.cellAddress.colIndex) {
      const aCbi = range.anchor.cellBlockIndex ?? 0;
      const fCbi = range.focus.cellBlockIndex ?? 0;
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
  if (start.cellAddress && end.cellAddress) {
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
    const lb = layout.blocks.find((b) => b.block.id === start.blockId);
    const tl = lb?.layoutTable;
    if (!tl || !start.cellAddress) {
      // Fallback: rect from start to end
      return [{
        x: startPixel.x,
        y: startPixel.y,
        width: endPixel.x - startPixel.x,
        height: endPixel.y + endPixel.height - startPixel.y,
      }];
    }
    const { rowIndex, colIndex } = start.cellAddress;
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
  if (normalized.start.blockId === normalized.end.blockId &&
      normalized.start.offset === normalized.end.offset &&
      (normalized.start.cellBlockIndex ?? 0) === (normalized.end.cellBlockIndex ?? 0)) return [];
  return buildRects(normalized.start, normalized.end, paginatedLayout, layout, ctx, canvasWidth);
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
    return (
      this.range.anchor.blockId !== this.range.focus.blockId ||
      this.range.anchor.offset !== this.range.focus.offset ||
      (this.range.anchor.cellBlockIndex ?? 0) !== (this.range.focus.cellBlockIndex ?? 0)
    );
  }

  getNormalizedRange(
    layout: DocumentLayout,
  ): { start: DocPosition; end: DocPosition } | null {
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

    const { start, end } = normalized;

    // Cell-internal selection
    if (start.cellAddress && end.cellAddress) {
      const lb = layout.blocks.find((b) => b.block.id === start.blockId);
      if (!lb?.block.tableData) return '';
      const cell = lb.block.tableData.rows[start.cellAddress.rowIndex]
        ?.cells[start.cellAddress.colIndex];
      if (!cell) return '';
      const startCbi = start.cellBlockIndex ?? 0;
      const endCbi = end.cellBlockIndex ?? 0;

      if (startCbi === endCbi) {
        const targetBlock = cell.blocks[startCbi];
        if (!targetBlock) return '';
        const blockText = targetBlock.inlines.map((i) => i.text).join('');
        return blockText.slice(start.offset, end.offset);
      }

      // Cross-block cell selection
      const texts: string[] = [];
      for (let bi = startCbi; bi <= endCbi; bi++) {
        const blk = cell.blocks[bi];
        if (!blk) continue;
        const fullText = blk.inlines.map((i) => i.text).join('');
        const s = bi === startCbi ? start.offset : 0;
        const e = bi === endCbi ? end.offset : fullText.length;
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
