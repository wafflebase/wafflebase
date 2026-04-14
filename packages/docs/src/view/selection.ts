import type { DocPosition, DocRange, TableCellRange, TableData, CellAddress } from '../model/types.js';
import { getBlockTextLength } from '../model/types.js';
import type { DocumentLayout, LayoutLine } from './layout.js';
import type { PaginatedLayout } from './pagination.js';
import { findPageForPosition, getPageYOffset, getPageXOffset } from './pagination.js';
import { resolvePositionPixel } from './peer-cursor.js';
import { computeMergedCellLineLayouts } from './table-renderer.js';
import { resolveNestedTableLayout } from './table-layout.js';
import { buildFont, Theme } from './theme.js';

// --- Free helpers (used by both Selection class and computeSelectionRects) ---

export interface NormalizedRange {
  start: DocPosition;
  end: DocPosition;
  tableCellRange?: TableCellRange;
}

/**
 * Walk back from `(r, c)` to the top-left of the merged cell that covers it.
 * Returns `(r, c)` itself if the cell is plain or already a merge top-left.
 *
 * The data model has no back-pointer, so we scan upward and leftward looking
 * for a cell whose `colSpan`/`rowSpan` reaches `(r, c)`. Tables are small in
 * practice; the cost is bounded by the table area.
 */
export function findMergeTopLeft(table: TableData, r: number, c: number): CellAddress {
  const cell = table.rows[r]?.cells[c];
  if (!cell) return { rowIndex: r, colIndex: c };
  if (cell.colSpan !== 0) return { rowIndex: r, colIndex: c };

  for (let rr = r; rr >= 0; rr--) {
    for (let cc = c; cc >= 0; cc--) {
      const candidate = table.rows[rr]?.cells[cc];
      if (!candidate) continue;
      const span = candidate.colSpan ?? 1;
      const rspan = candidate.rowSpan ?? 1;
      if (span > 1 || rspan > 1) {
        if (rr + rspan - 1 >= r && cc + span - 1 >= c) {
          return { rowIndex: rr, colIndex: cc };
        }
      }
    }
  }
  return { rowIndex: r, colIndex: c };
}

/**
 * Expand a cell range to a bounding rectangle that fully contains every
 * merged cell it touches. Runs a fixed-point loop because expanding for one
 * merge can pull a previously-out-of-range merge into the rect.
 *
 * Caller may pass an unordered range — this helper orders start/end first.
 */
export function expandCellRangeForMerges(
  cr: TableCellRange,
  table: TableData,
): TableCellRange {
  let rowStart = Math.min(cr.start.rowIndex, cr.end.rowIndex);
  let rowEnd = Math.max(cr.start.rowIndex, cr.end.rowIndex);
  let colStart = Math.min(cr.start.colIndex, cr.end.colIndex);
  let colEnd = Math.max(cr.start.colIndex, cr.end.colIndex);

  let changed = true;
  while (changed) {
    changed = false;
    for (let r = rowStart; r <= rowEnd; r++) {
      for (let c = colStart; c <= colEnd; c++) {
        const cell = table.rows[r]?.cells[c];
        if (!cell) continue;
        const span = cell.colSpan ?? 1;
        const rspan = cell.rowSpan ?? 1;

        // Top-left of a merge whose span extends past current rect.
        if (span > 1 || rspan > 1) {
          const r2 = r + rspan - 1;
          const c2 = c + span - 1;
          if (r2 > rowEnd) { rowEnd = r2; changed = true; }
          if (c2 > colEnd) { colEnd = c2; changed = true; }
        }

        // Covered cell whose top-left is outside current rect.
        if (cell.colSpan === 0) {
          const tl = findMergeTopLeft(table, r, c);
          if (tl.rowIndex < rowStart) { rowStart = tl.rowIndex; changed = true; }
          if (tl.colIndex < colStart) { colStart = tl.colIndex; changed = true; }
        }
      }
    }
  }

  return {
    blockId: cr.blockId,
    start: { rowIndex: rowStart, colIndex: colStart },
    end: { rowIndex: rowEnd, colIndex: colEnd },
  };
}

function normalizeCellRange(cr: TableCellRange, table?: TableData): TableCellRange {
  const ordered: TableCellRange = {
    blockId: cr.blockId,
    start: {
      rowIndex: Math.min(cr.start.rowIndex, cr.end.rowIndex),
      colIndex: Math.min(cr.start.colIndex, cr.end.colIndex),
    },
    end: {
      rowIndex: Math.max(cr.start.rowIndex, cr.end.rowIndex),
      colIndex: Math.max(cr.start.colIndex, cr.end.colIndex),
    },
  };
  return table ? expandCellRangeForMerges(ordered, table) : ordered;
}

function normalizeRange(
  range: DocRange,
  layout: DocumentLayout,
): NormalizedRange | null {
  // Cell-range mode: tableCellRange is set
  if (range.tableCellRange) {
    const lb = layout.blocks.find((b) => b.block.id === range.tableCellRange!.blockId);
    const table = lb?.block.tableData;
    return {
      start: range.anchor,
      end: range.focus,
      tableCellRange: normalizeCellRange(range.tableCellRange, table),
    };
  }

  // Cell-aware selection: check before top-level index lookup since cell
  // block IDs are not in layout.blocks (they live inside table blocks).
  const anchorCellInfo = layout.blockParentMap.get(range.anchor.blockId);
  const focusCellInfo = layout.blockParentMap.get(range.focus.blockId);


  // For nested tables, walk up the blockParentMap chain to find the
  // outermost table ID that exists in layout.blocks.
  let anchorTopId = anchorCellInfo?.tableBlockId ?? range.anchor.blockId;
  while (anchorTopId && layout.blocks.findIndex((lb) => lb.block.id === anchorTopId) === -1) {
    const parentInfo = layout.blockParentMap.get(anchorTopId);
    if (!parentInfo) break;
    anchorTopId = parentInfo.tableBlockId;
  }
  let focusTopId = focusCellInfo?.tableBlockId ?? range.focus.blockId;
  while (focusTopId && layout.blocks.findIndex((lb) => lb.block.id === focusTopId) === -1) {
    const parentInfo = layout.blockParentMap.get(focusTopId);
    if (!parentInfo) break;
    focusTopId = parentInfo.tableBlockId;
  }
  const anchorIdx = layout.blocks.findIndex((lb) => lb.block.id === anchorTopId);
  const focusIdx = layout.blocks.findIndex((lb) => lb.block.id === focusTopId);
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
      let xOffset: number;
      if (run.imageHeight !== undefined) {
        xOffset = localOff > 0 ? run.width : 0;
      } else {
        const isSuperOrSub = run.inline.style.superscript || run.inline.style.subscript;
        const measureFontSize = isSuperOrSub
          ? (run.inline.style.fontSize ?? Theme.defaultFontSize) * 0.6
          : run.inline.style.fontSize;
        ctx.font = buildFont(
          measureFontSize, run.inline.style.fontFamily,
          run.inline.style.bold, run.inline.style.italic,
        );
        xOffset = ctx.measureText(run.text.slice(0, localOff)).width;
      }
      const x = pageX + pageLine.x + run.x + xOffset;
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

    // Multi-line cell selection: walk the cell's lines from start to end
    // and emit one rect per line. Each line's absolute Y is derived from
    // computeMergedCellLineLayouts so per-row distribution (merged cells
    // split across pages) stays consistent with the renderer. The old
    // "advance midY by line height" path stepped linearly through the
    // cell's Y axis and painted into the empty space below row 0 when a
    // merged cell's line actually lived on the next page.
    const lb = layout.blocks.find((b) => b.block.id === startCellInfo.tableBlockId);
    const tl = lb?.layoutTable;
    if (!lb || !tl) {
      // Nested table cell — the direct parent table is not a top-level
      // layout block. Use pixel coordinates from resolvePositionPixel
      // (which already handles nested tables) for selection rects.
      if (startPixel.y === endPixel.y) {
        return [{
          x: startPixel.x,
          y: startPixel.y,
          width: endPixel.x - startPixel.x,
          height: startPixel.height,
        }];
      }
      return [{
        x: Math.min(startPixel.x, endPixel.x),
        y: startPixel.y,
        width: Math.max(startPixel.x, endPixel.x) - Math.min(startPixel.x, endPixel.x),
        height: endPixel.y + endPixel.height - startPixel.y,
      }];
    }
    const { rowIndex, colIndex } = startCellInfo;
    const layoutCell = tl.cells[rowIndex]?.[colIndex];
    const cellData = lb.block.tableData?.rows[rowIndex]?.cells[colIndex];
    if (!layoutCell || layoutCell.merged || !cellData) {
      return [{
        x: startPixel.x,
        y: startPixel.y,
        width: endPixel.x - startPixel.x,
        height: endPixel.y + endPixel.height - startPixel.y,
      }];
    }
    const cellPadding = cellData.style?.padding ?? 4;
    const rowSpan = cellData.rowSpan ?? 1;

    const pageXOffset = getPageXOffset(paginatedLayout, canvasWidth);
    const { margins } = paginatedLayout.pageSetup;
    const cellLeftX = pageXOffset + margins.left + tl.columnXOffsets[colIndex] + cellPadding;
    const cellRightX =
      pageXOffset + margins.left + tl.columnXOffsets[colIndex] + layoutCell.width - cellPadding;

    // Locate the cell's block containing the start/end positions and the
    // corresponding line indices within cell.lines.
    const startCbi = cellData.blocks.findIndex((b) => b.id === start.blockId);
    const endCbi = cellData.blocks.findIndex((b) => b.id === end.blockId);
    const startCbiEff = startCbi >= 0 ? startCbi : 0;
    const endCbiEff = endCbi >= 0 ? endCbi : 0;

    // Find the cell-internal line index for a given offset. At a visual
    // wrap boundary (offset === cumulative chars) forward affinity
    // belongs to the next line (matching how `resolvePositionPixel` uses
    // 'forward' for `start`), while backward affinity stays on the
    // current line (matching `end`). Without this bias a wrapped cell
    // selection can render an extra rect on the previous line or miss
    // the first rect on the next one.
    const lineIdxForOffset = (
      cbiEff: number,
      offset: number,
      affinity: 'forward' | 'backward',
    ): number => {
      const lineStart = layoutCell.blockBoundaries[cbiEff] ?? 0;
      const lineEnd =
        layoutCell.blockBoundaries[cbiEff + 1] ?? layoutCell.lines.length;
      let remaining = offset;
      for (let li = lineStart; li < lineEnd; li++) {
        let lineChars = 0;
        for (const run of layoutCell.lines[li].runs) lineChars += run.text.length;
        if (remaining <= lineChars) {
          if (
            affinity === 'forward' &&
            remaining === lineChars &&
            li < lineEnd - 1
          ) {
            remaining = 0;
            continue;
          }
          return li;
        }
        remaining -= lineChars;
      }
      return Math.max(lineStart, lineEnd - 1);
    };

    const startLineIdx = lineIdxForOffset(startCbiEff, start.offset, 'forward');
    const endLineIdx = lineIdxForOffset(endCbiEff, end.offset, 'backward');

    const lineLayouts = computeMergedCellLineLayouts(
      layoutCell.lines,
      rowIndex,
      rowSpan,
      cellPadding,
      tl.rowYOffsets,
      tl.rowHeights,
    );

    const blockIndex = layout.blocks.indexOf(lb);
    const resolveLineAbsoluteY = (ownerRow: number, runLineY: number): number | undefined => {
      for (const page of paginatedLayout.pages) {
        for (const pl of page.lines) {
          if (pl.blockIndex === blockIndex && pl.lineIndex === ownerRow) {
            const pageY = getPageYOffset(paginatedLayout, page.pageIndex);
            return pageY + pl.y + (runLineY - tl.rowYOffsets[ownerRow]);
          }
        }
      }
      return undefined;
    };

    const cellRects: Array<{ x: number; y: number; width: number; height: number }> = [];
    for (let li = startLineIdx; li <= endLineIdx; li++) {
      const line = layoutCell.lines[li];
      const ll = lineLayouts[li];
      if (!ll) continue;
      const lineY = resolveLineAbsoluteY(ll.ownerRow, ll.runLineY);
      if (lineY === undefined) continue;

      let lineX: number;
      let lineWidth: number;
      if (li === startLineIdx && li === endLineIdx) {
        lineX = startPixel.x;
        lineWidth = endPixel.x - startPixel.x;
      } else if (li === startLineIdx) {
        lineX = startPixel.x;
        lineWidth = cellRightX - startPixel.x;
      } else if (li === endLineIdx) {
        lineX = cellLeftX;
        lineWidth = endPixel.x - cellLeftX;
      } else {
        lineX = cellLeftX;
        lineWidth = cellRightX - cellLeftX;
      }
      cellRects.push({ x: lineX, y: lineY, width: lineWidth, height: line.height });
    }
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
 *
 * Row Y positions are read from the paginated layout (one `PageLine` per
 * table row) so the highlight sits on the same pixel band as the rendered
 * rows even when the table spans multiple pages. `tl.rowYOffsets` is a
 * contiguous table-logical coordinate and cannot be used directly.
 */
function buildCellRangeRects(
  cellRange: TableCellRange,
  paginatedLayout: PaginatedLayout,
  layout: DocumentLayout,
  canvasWidth: number,
): Array<{ x: number; y: number; width: number; height: number }> {
  // Resolve the table — may be top-level or nested
  const resolved = resolveNestedTableLayout(cellRange.blockId, layout);
  if (!resolved) return [];
  const { lb, layoutTable: tl, dataBlock, xOffset: nestedXOffset, yOffset: nestedYOffset, outerRowIndex } = resolved;

  const blockIndex = lb.blockIndex;
  const pageX = getPageXOffset(paginatedLayout, canvasWidth);
  const { margins } = paginatedLayout.pageSetup;

  // For nested tables, we need the absolute Y of the outermost row that
  // contains the nested table. For top-level tables, build the full row map.
  let baseY = 0;
  if (outerRowIndex >= 0) {
    // Nested table — find the page line for the outer row
    for (const page of paginatedLayout.pages) {
      const pageY = getPageYOffset(paginatedLayout, page.pageIndex);
      for (const pl of page.lines) {
        if (pl.blockIndex === blockIndex && pl.lineIndex === outerRowIndex) {
          baseY = pageY + pl.y + nestedYOffset;
          break;
        }
      }
    }
  }

  // Build a row → absolute Y map
  const rowYMap = new Map<number, number>();
  if (outerRowIndex >= 0) {
    // Nested: compute Y for each inner row from baseY + inner rowYOffsets
    for (let r = 0; r < tl.rowYOffsets.length; r++) {
      rowYMap.set(r, baseY + tl.rowYOffsets[r]);
    }
  } else {
    // Top-level: use paginated layout
    for (const page of paginatedLayout.pages) {
      const pageY = getPageYOffset(paginatedLayout, page.pageIndex);
      for (const pl of page.lines) {
        if (pl.blockIndex !== blockIndex) continue;
        rowYMap.set(pl.lineIndex, pageY + pl.y);
      }
    }
  }

  const { start, end } = cellRange;
  const rects: Array<{ x: number; y: number; width: number; height: number }> = [];
  const tableData = dataBlock.tableData;
  const xBase = pageX + margins.left + nestedXOffset;

  for (let r = start.rowIndex; r <= end.rowIndex; r++) {
    for (let c = start.colIndex; c <= end.colIndex; c++) {
      const cell = tl.cells[r]?.[c];
      if (!cell || cell.merged) continue;

      const srcCell = tableData?.rows[r]?.cells[c];
      const rowSpan = srcCell?.rowSpan ?? 1;
      const x = xBase + tl.columnXOffsets[c];
      const width = cell.width;

      const spanEnd = Math.min(r + rowSpan, tl.rowHeights.length);
      let segmentTop: number | undefined;
      let segmentHeight = 0;
      for (let rr = r; rr < spanEnd; rr++) {
        const rrY = rowYMap.get(rr);
        if (rrY === undefined) continue;
        if (segmentTop === undefined) {
          segmentTop = rrY;
        } else if (Math.abs(rrY - (segmentTop + segmentHeight)) > 0.5) {
          rects.push({ x, y: segmentTop, width, height: segmentHeight });
          segmentTop = rrY;
          segmentHeight = 0;
        }
        segmentHeight += tl.rowHeights[rr];
      }
      if (segmentTop !== undefined && segmentHeight > 0) {
        rects.push({ x, y: segmentTop, width, height: segmentHeight });
      }
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
