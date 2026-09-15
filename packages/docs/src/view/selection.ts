import type { DocPosition, DocRange, TableCellRange, TableData, CellAddress } from '../model/types.js';
import { getBlockTextLength } from '../model/types.js';
import type { DocumentLayout, LayoutLine } from './layout.js';
import { caretOffsetX } from './layout.js';
import type { PaginatedLayout } from './pagination.js';
import { findPageForPosition, findPageLine, getPageYOffset, getPageXOffset, getBlockIndex } from './pagination.js';
import { resolvePositionPixel } from './peer-cursor.js';
import { computeMergedCellLineLayouts } from './table-renderer.js';
import { resolveNestedTableLayout } from './table-layout.js';
import type { TextMeasurer } from './measurer.js';

// --- Free helpers (used by both Selection class and computeSelectionRects) ---

export interface NormalizedRange {
  start: DocPosition;
  end: DocPosition;
  tableCellRange?: TableCellRange;
}

/**
 * Cells one *presence-driven* `expandCellRangeForMerges` call will look at —
 * its own scan plus every `findMergeTopLeft` backtrack it makes — before it
 * stops growing the rectangle and returns what it has.
 *
 * It bounds every caller that does not *act* on the rectangle it gets back:
 * `computeSelectionRects` (the paint, once per peer per paint), and the two
 * `getNormalizedRange` callers that read no cell rectangle at all — the
 * arrow-key collapse, which uses only `start`/`end`, and
 * `formatSourcePosition`, which picks a cell to read a style from. Those run
 * per keystroke, so leaving them unbounded would put a peer-sized table on the
 * typing path.
 *
 * The expansion stays exact everywhere it feeds a *write*: the gesture and
 * command paths (`computeTableMergeContext`, the drag and Shift+Arrow handlers
 * in `text-editor.ts`) call `expandCellRangeForMerges` directly, and the
 * delete, copy and cut paths reach `normalizeCellRange` through
 * `Selection.getNormalizedRange`. `doc.mergeCells` writes whatever rectangle
 * it is handed and the delete clears whatever rectangle it is handed, so a
 * partially-expanded one cuts an existing merge in half or leaves half of one
 * uncleared — a silent, replicated corruption, which is a worse answer than a
 * slow gesture. Those callers are one deliberate command over one table, not
 * once per keystroke.
 *
 * The rectangle is clamped to the table (`normalizeCellRange`), but the
 * *table* is a peer's to choose: rows are structure, not an attribute, so no
 * numeric band reaches them, and a peer can write as many as it likes. The
 * expansion is superlinear in that size — a fixed-point `while (changed)` loop
 * whose every pass rescans the whole rectangle, and whose covered cells each
 * backtrack over the area above-left of them — while the layout that paints
 * the same table is merely linear in it. And it runs on the render path:
 * `computeSelectionRects` normalizes once per peer per paint. So the budget
 * bounds the *amplification*, not the table: a table big enough to trip it
 * already costs more to lay out than to expand.
 *
 * Past the budget the rectangle is the partially-expanded one, so a merge at
 * its edge paints short — the same "degrade, do not hang" direction the
 * numeric bands and the nesting cap take.
 */
export const MAX_MERGE_EXPANSION_CELLS = 1 << 18;

/** The cells one expansion has left to look at. */
type ScanBudget = { left: number };

/**
 * Walk back from `(r, c)` to the top-left of the merged cell that covers it.
 * Returns `(r, c)` itself if the cell is plain or already a merge top-left.
 *
 * The data model has no back-pointer, so we scan upward and leftward looking
 * for a cell whose `colSpan`/`rowSpan` reaches `(r, c)`. Tables are small in
 * practice; the cost is bounded by the table area.
 */
export function findMergeTopLeft(table: TableData, r: number, c: number): CellAddress {
  return findMergeTopLeftBudgeted(table, r, c, { left: Infinity });
}

/**
 * `findMergeTopLeft` with a caller-owned work counter, so a scan that runs
 * inside another bounded walk is charged to the same budget. An orphan covered
 * cell (one whose owner was never written) is the expensive case: it scans
 * every cell above-left of itself before giving up. Out of budget it answers
 * `(r, c)` — the same answer it gives when no owner exists.
 *
 * `{ left: Infinity }` restores the unbounded behaviour for the public entry
 * point, whose callers are all driven by local gestures over one table.
 */
function findMergeTopLeftBudgeted(
  table: TableData,
  r: number,
  c: number,
  budget: ScanBudget,
): CellAddress {
  const cell = table.rows[r]?.cells[c];
  if (!cell) return { rowIndex: r, colIndex: c };
  if (cell.colSpan !== 0) return { rowIndex: r, colIndex: c };

  for (let rr = r; rr >= 0; rr--) {
    for (let cc = c; cc >= 0; cc--) {
      if (--budget.left <= 0) return { rowIndex: r, colIndex: c };
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
 *
 * **Exact by default.** `budgetCells` exists for the callers that paint or
 * probe rather than act — `computeSelectionRects`, and the per-keystroke
 * `getNormalizedRange` callers that never read the rectangle's cells. A
 * caller that feeds the result to a write (`mergeCells`, the cell-rectangle
 * delete, the selection a merge or a copy is later taken from) must not pass
 * one: there a rectangle that stopped growing early is not a cosmetic
 * short-paint but a merge that slices through an existing one — or a merged
 * cell left uncleared. See `MAX_MERGE_EXPANSION_CELLS`.
 */
export function expandCellRangeForMerges(
  cr: TableCellRange,
  table: TableData,
  budgetCells = Infinity,
): TableCellRange {
  let rowStart = Math.min(cr.start.rowIndex, cr.end.rowIndex);
  let rowEnd = Math.max(cr.start.rowIndex, cr.end.rowIndex);
  let colStart = Math.min(cr.start.colIndex, cr.end.colIndex);
  let colEnd = Math.max(cr.start.colIndex, cr.end.colIndex);

  const budget: ScanBudget = { left: budgetCells };
  let changed = true;
  while (changed && budget.left > 0) {
    changed = false;
    for (let r = rowStart; r <= rowEnd && budget.left > 0; r++) {
      for (let c = colStart; c <= colEnd && budget.left > 0; c++) {
        budget.left--;
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
          const tl = findMergeTopLeftBudgeted(table, r, c, budget);
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

/**
 * One row/column index of a cell rectangle as a grid coordinate every consumer
 * can loop over: a finite integer in `[0, max]`. A non-finite one reads as 0,
 * the neutral coordinate, exactly as an out-of-band numeric attribute reads as
 * its default.
 */
function clampCellIndex(raw: number, max: number): number {
  if (!Number.isFinite(raw)) return 0;
  return Math.min(Math.max(Math.trunc(raw), 0), Math.max(max, 0));
}

/**
 * Order a cell rectangle, clamp it to the table it names, then expand it to
 * cover the merges it touches.
 *
 * The clamp is not cosmetic. A `tableCellRange` is part of a peer's presence
 * and reaches here verbatim off the wire — `docs-view.tsx` copies
 * `sel.tableCellRange` straight into `PeerCursor.selection`, and
 * `computeSelectionRects` normalizes that range once per paint — so its
 * indices are peer-written numbers rather than coordinates this editor
 * produced. Every consumer walks them as bounds (`for (r = start.rowIndex; r
 * <= end.rowIndex; r++)` in `buildCellRangeRects` on the render path, in
 * `getSelectedText` on copy), so an `end` of `1e9` or a `start` of `-1e9`
 * spins those loops for the rest of the session. That is the same "one peer's
 * attribute hangs everyone's tab" hazard the numeric bands and the
 * `blockParentMap` cycle guards close, arriving through the other peer-written
 * field on the same path.
 *
 * A rectangle whose table did not resolve is only ordered, as before — every
 * consumer of one bails on the missing table before it loops, and
 * `buildCellRangeRects` bounds its own loops by the layout table besides.
 */
function normalizeCellRange(
  cr: TableCellRange,
  table?: TableData,
  budgetCells = Infinity,
): TableCellRange {
  const maxRow = table ? table.rows.length - 1 : Infinity;
  // Folded rather than spread: `Math.max(...rows)` throws `RangeError` past
  // ~100k arguments, and the row count is a peer's to choose.
  const maxCol = table
    ? table.rows.reduce((m, r) => Math.max(m, r.cells.length), table.columnWidths.length) - 1
    : Infinity;
  const rows = [clampCellIndex(cr.start.rowIndex, maxRow), clampCellIndex(cr.end.rowIndex, maxRow)];
  const cols = [clampCellIndex(cr.start.colIndex, maxCol), clampCellIndex(cr.end.colIndex, maxCol)];
  const ordered: TableCellRange = {
    blockId: cr.blockId,
    start: { rowIndex: Math.min(...rows), colIndex: Math.min(...cols) },
    end: { rowIndex: Math.max(...rows), colIndex: Math.max(...cols) },
  };
  // Exact unless the caller is the painter, which is the only one that passes
  // a budget. See `MAX_MERGE_EXPANSION_CELLS`.
  return table
    ? expandCellRangeForMerges(ordered, table, budgetCells)
    : ordered;
}

/**
 * Walk up `blockParentMap` until an id that exists in `layout.blocks` is
 * reached, and return it. The caller's own `findIndex` still decides whether
 * it resolved.
 *
 * Carries the same cycle guard as `resolveNestedTableLayout`: block ids arrive
 * verbatim from peer-written CRDT attributes, so a parent chain that loops
 * back on itself is representable, and this walk runs on the render path. A
 * cycle stops the walk instead of hanging the tab; the id it stops on is not
 * in `layout.blocks` (a cycle never reaches a top-level block), so the caller
 * reads it as unresolvable.
 */
function walkToTopLevelBlockId(
  startId: string,
  layout: DocumentLayout,
): string {
  let id = startId;
  const seen = new Set<string>([id]);
  while (id && layout.blocks.findIndex((lb) => lb.block.id === id) === -1) {
    const parentInfo = layout.blockParentMap.get(id);
    if (!parentInfo || seen.has(parentInfo.tableBlockId)) break;
    id = parentInfo.tableBlockId;
    seen.add(id);
  }
  return id;
}

/**
 * `budgetCells` bounds the merge expansion below and defaults to exact. The
 * paint (`computeSelectionRects`) passes one, as do the two
 * `Selection.getNormalizedRange` callers that never read the rectangle's
 * cells; the rest act on what they get back (clear the cells, copy them, cut
 * them), and for those a rectangle that stopped growing early is a merged cell
 * half-cleared rather than a merge painted short. See
 * `MAX_MERGE_EXPANSION_CELLS`.
 */
function normalizeRange(
  range: DocRange,
  layout: DocumentLayout,
  budgetCells = Infinity,
): NormalizedRange | null {
  // Cell-range mode: tableCellRange is set
  if (range.tableCellRange) {
    // A top-level table answers from the block list alone. A nested one is
    // not in `layout.blocks` at all, so the flat lookup missed it, `table`
    // came back undefined, and the merge expansion below was a silent no-op
    // — the columns a merge covers then painted only inside the merged row
    // (#1049). Fall back to the same resolver `buildCellRangeRects` uses, so
    // the rectangle that gets painted is the rectangle that got expanded.
    const crBlockId = range.tableCellRange.blockId;
    const table =
      layout.blocks.find((b) => b.block.id === crBlockId)?.block.tableData ??
      resolveNestedTableLayout(crBlockId, layout)?.dataBlock.tableData;
    return {
      start: range.anchor,
      end: range.focus,
      tableCellRange: normalizeCellRange(
        range.tableCellRange,
        table,
        budgetCells,
      ),
    };
  }

  // Cell-aware selection: check before top-level index lookup since cell
  // block IDs are not in layout.blocks (they live inside table blocks).
  const anchorCellInfo = layout.blockParentMap.get(range.anchor.blockId);
  const focusCellInfo = layout.blockParentMap.get(range.focus.blockId);


  // For nested tables, walk up the blockParentMap chain to find the
  // outermost table ID that exists in layout.blocks.
  const anchorTopId = walkToTopLevelBlockId(
    anchorCellInfo?.tableBlockId ?? range.anchor.blockId,
    layout,
  );
  const focusTopId = walkToTopLevelBlockId(
    focusCellInfo?.tableBlockId ?? range.focus.blockId,
    layout,
  );
  const anchorIdx = layout.blocks.findIndex((lb) => lb.block.id === anchorTopId);
  const focusIdx = layout.blocks.findIndex((lb) => lb.block.id === focusTopId);
  if (anchorIdx === -1 || focusIdx === -1) return null;
  if (anchorCellInfo || focusCellInfo) {
    // Both must be in the same cell for a valid selection
    if (anchorCellInfo && focusCellInfo &&
        anchorCellInfo.tableBlockId === focusCellInfo.tableBlockId &&
        anchorCellInfo.rowIndex === focusCellInfo.rowIndex &&
        anchorCellInfo.colIndex === focusCellInfo.colIndex) {
      // Find cell block indices for ordering — use resolveNestedTableLayout
      // so nested table cells are found correctly.
      const resolvedTable = resolveNestedTableLayout(anchorCellInfo.tableBlockId, layout);
      const cell = resolvedTable?.dataBlock.tableData?.rows[anchorCellInfo.rowIndex]?.cells[anchorCellInfo.colIndex];
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
  measurer: TextMeasurer,
  canvasWidth: number,
  blockId: string,
  offset: number,
  lineAffinity: 'forward' | 'backward' = 'backward',
): { x: number; y: number; height: number } | undefined {
  const found = findPageForPosition(paginatedLayout, blockId, offset, layout, lineAffinity);
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
        xOffset = caretOffsetX(run, localOff, measurer);
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
  measurer: TextMeasurer,
  canvasWidth: number,
): Array<{ x: number; y: number; width: number; height: number }> {
  // A selection endpoint that landed on a visual wrap boundary carries the
  // affinity of the click (or caret move) that produced it. Without one,
  // keep the historical reading: the start looks forward (the highlight
  // begins on the line the offset opens) and the end looks backward (it
  // ends on the line the offset closes).
  const startAffinity = start.lineAffinity ?? 'forward';
  const endAffinity = end.lineAffinity ?? 'backward';

  // Cell-internal selection
  const startCellInfo = layout.blockParentMap.get(start.blockId);
  const endCellInfo = layout.blockParentMap.get(end.blockId);

  if (startCellInfo && endCellInfo) {
    const startPixel = resolvePositionPixel(start, startAffinity, paginatedLayout, layout, measurer, canvasWidth);
    const endPixel = resolvePositionPixel(end, endAffinity, paginatedLayout, layout, measurer, canvasWidth);

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
    // Resolve the table that owns this cell — may be top-level or nested
    const resolved = resolveNestedTableLayout(startCellInfo.tableBlockId, layout);
    const lb = resolved ? layout.blocks[resolved.lb.blockIndex] : undefined;
    const tl = resolved?.layoutTable;
    if (!lb || !tl || !resolved) {
      return [{
        x: startPixel.x,
        y: startPixel.y,
        width: endPixel.x - startPixel.x,
        height: endPixel.y + endPixel.height - startPixel.y,
      }];
    }
    const { rowIndex, colIndex } = startCellInfo;
    const layoutCell = tl.cells[rowIndex]?.[colIndex];
    const cellData = resolved.dataBlock.tableData?.rows[rowIndex]?.cells[colIndex];
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
    const nestedXOff = resolved.xOffset;
    const cellLeftX = pageXOffset + margins.left + nestedXOff + tl.columnXOffsets[colIndex] + cellPadding;
    const cellRightX =
      pageXOffset + margins.left + nestedXOff + tl.columnXOffsets[colIndex] + layoutCell.width - cellPadding;

    // Locate the cell's block containing the start/end positions and the
    // corresponding line indices within cell.lines.
    const startCbi = cellData.blocks.findIndex((b) => b.id === start.blockId);
    const endCbi = cellData.blocks.findIndex((b) => b.id === end.blockId);
    const startCbiEff = startCbi >= 0 ? startCbi : 0;
    const endCbiEff = endCbi >= 0 ? endCbi : 0;

    // Find the cell-internal line index for a given offset. At a visual
    // wrap boundary (offset === cumulative chars) forward affinity
    // belongs to the next line, while backward affinity stays on the
    // current line — the same reading `resolvePositionPixel` is given
    // above, so the rect and the pixel agree. Without this bias a wrapped cell
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

    const startLineIdx = lineIdxForOffset(startCbiEff, start.offset, startAffinity);
    const endLineIdx = lineIdxForOffset(endCbiEff, end.offset, endAffinity);

    const lineLayouts = computeMergedCellLineLayouts(
      layoutCell.lines,
      rowIndex,
      rowSpan,
      cellPadding,
      tl.rowYOffsets,
      tl.rowHeights,
    );

    const blockIndex = resolved.lb.blockIndex;
    const nestedYOff = resolved.yOffset;
    const isNested = resolved.outerRowIndex >= 0;
    const resolveLineAbsoluteY = (ownerRow: number, runLineY: number): number | undefined => {
      if (isNested) {
        const outerRow = resolved.outerRowIndex;
        const found = findPageLine(paginatedLayout, blockIndex, outerRow);
        if (!found) return undefined;
        return found.pageY + found.pageLine.y + nestedYOff
          + tl.rowYOffsets[ownerRow]
          + (runLineY - tl.rowYOffsets[ownerRow]);
      }
      // For split rows, multiple PageLines share the same blockIndex +
      // lineIndex. Pick the fragment whose visible range contains runLineY
      // (relative to the row top).
      let bestResult: number | undefined;
      for (const page of paginatedLayout.pages) {
        for (const pl of page.lines) {
          if (pl.blockIndex === blockIndex && pl.lineIndex === ownerRow) {
            const pageY = getPageYOffset(paginatedLayout, page.pageIndex);
            const splitOffset = pl.rowSplitOffset ?? 0;
            const absY = pageY + pl.y + (runLineY - tl.rowYOffsets[ownerRow]) - splitOffset;
            if (pl.rowSplitHeight === undefined) {
              return absY; // non-split row
            }
            // Check if this line falls within this fragment's range
            const lineInRow = runLineY - tl.rowYOffsets[ownerRow];
            if (lineInRow >= splitOffset && lineInRow < splitOffset + pl.rowSplitHeight) {
              return absY;
            }
            bestResult = absY; // fallback to last
          }
        }
      }
      return bestResult;
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

  const startBlockIdx = getBlockIndex(layout, start.blockId);
  const endBlockIdx = getBlockIndex(layout, end.blockId);
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

    // Only the real endpoints can sit on an ambiguous wrap boundary. An
    // interior block runs from offset 0 to its text length, and neither of
    // those is shared by two visual lines, so they keep the default.
    const blockStartAffinity = bi === startBlockIdx ? startAffinity : 'backward';
    const blockEndAffinity = bi === endBlockIdx ? endAffinity : 'backward';

    const startPixel = positionToPagePixel(
      paginatedLayout, layout, measurer, canvasWidth, lb.block.id, blockStart,
      blockStartAffinity,
    );
    const endPixel = positionToPagePixel(
      paginatedLayout, layout, measurer, canvasWidth, lb.block.id, blockEnd,
      blockEndAffinity,
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
      const startFound = findPageForPosition(
        paginatedLayout, lb.block.id, blockStart, layout, blockStartAffinity,
      );
      const endFound = findPageForPosition(
        paginatedLayout, lb.block.id, blockEnd, layout, blockEndAffinity,
      );
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
 *
 * The one bounded normalization: this runs once per peer selection per paint
 * over a rectangle and a table that both reach it from presence, and a
 * rectangle that stops growing early paints a merge short rather than
 * corrupting anything. See `MAX_MERGE_EXPANSION_CELLS`.
 */
export function computeSelectionRects(
  range: DocRange,
  paginatedLayout: PaginatedLayout,
  layout: DocumentLayout,
  measurer: TextMeasurer,
  canvasWidth: number,
): Array<{ x: number; y: number; width: number; height: number }> {
  const normalized = normalizeRange(range, layout, MAX_MERGE_EXPANSION_CELLS);
  if (!normalized) return [];

  // Cell-range mode: highlight entire cells
  if (normalized.tableCellRange) {
    return buildCellRangeRects(normalized.tableCellRange, paginatedLayout, layout, canvasWidth);
  }

  if (normalized.start.blockId === normalized.end.blockId &&
      normalized.start.offset === normalized.end.offset) return [];
  return buildRects(normalized.start, normalized.end, paginatedLayout, layout, measurer, canvasWidth);
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
  // Build a row → absolute Y fragments list. For split rows, multiple
  // fragments share the same lineIndex; each gets its own entry so the
  // selection highlight appears on every page the row spans.
  const rowFrags = new Map<number, Array<{ y: number; height: number }>>();
  if (outerRowIndex >= 0) {
    // Nested table inside a (possibly split) outer row.
    // Collect all outer-row fragments so inner rows that fall on
    // different pages each get their own rect.
    const outerFragments: Array<{ pageY: number; plY: number; splitOff: number; splitH: number }> = [];
    for (const page of paginatedLayout.pages) {
      const pY = getPageYOffset(paginatedLayout, page.pageIndex);
      for (const pl of page.lines) {
        if (pl.blockIndex === blockIndex && pl.lineIndex === outerRowIndex) {
          outerFragments.push({
            pageY: pY,
            plY: pl.y,
            splitOff: pl.rowSplitOffset ?? 0,
            splitH: pl.rowSplitHeight ?? pl.line.height,
          });
        }
      }
    }

    for (let r = 0; r < tl.rowYOffsets.length; r++) {
      const innerRowTop = nestedYOffset + tl.rowYOffsets[r];
      const innerRowH = tl.rowHeights[r];
      const entries: Array<{ y: number; height: number }> = [];

      for (const frag of outerFragments) {
        const fragEnd = frag.splitOff + frag.splitH;
        // Check if this inner row overlaps the fragment's visible range
        if (innerRowTop + innerRowH <= frag.splitOff || innerRowTop >= fragEnd) continue;
        // Clamp the visible portion to the fragment bounds
        const visTop = Math.max(innerRowTop, frag.splitOff);
        const visBot = Math.min(innerRowTop + innerRowH, fragEnd);
        const y = frag.pageY + frag.plY + (visTop - frag.splitOff);
        entries.push({ y, height: visBot - visTop });
      }

      if (entries.length > 0) {
        rowFrags.set(r, entries);
      }
    }
  } else {
    // Top-level: use paginated layout (split rows produce multiple entries)
    for (const page of paginatedLayout.pages) {
      const pageY = getPageYOffset(paginatedLayout, page.pageIndex);
      for (const pl of page.lines) {
        if (pl.blockIndex !== blockIndex) continue;
        const visibleHeight = pl.rowSplitHeight ?? tl.rowHeights[pl.lineIndex];
        const entries = rowFrags.get(pl.lineIndex) ?? [];
        entries.push({ y: pageY + pl.y, height: visibleHeight });
        rowFrags.set(pl.lineIndex, entries);
      }
    }
  }

  const { start, end } = cellRange;
  const rects: Array<{ x: number; y: number; width: number; height: number }> = [];
  const tableData = dataBlock.tableData;
  const xBase = pageX + margins.left + nestedXOffset;

  // Bounded by the table that actually resolved, not by the rectangle's own
  // numbers: this runs once per peer selection per paint, and the rectangle
  // reaches it from presence (see `normalizeCellRange`). `normalizeCellRange`
  // clamps whenever it can resolve the table, and this is the same bound read
  // off the layout, so a rectangle that slipped past it — a table that
  // resolves here but not there — costs a bounded walk rather than a hung tab.
  const rowStart = Math.max(0, start.rowIndex);
  const rowEnd = Math.min(end.rowIndex, tl.cells.length - 1);
  const colStart = Math.max(0, start.colIndex);
  const colEnd = Math.min(end.colIndex, tl.columnXOffsets.length - 1);

  for (let r = rowStart; r <= rowEnd; r++) {
    for (let c = colStart; c <= colEnd; c++) {
      const cell = tl.cells[r]?.[c];
      if (!cell || cell.merged) continue;

      const srcCell = tableData?.rows[r]?.cells[c];
      const rowSpan = srcCell?.rowSpan ?? 1;
      const x = xBase + tl.columnXOffsets[c];
      const width = cell.width;

      // Collect all visible fragments for the spanned rows
      for (let rr = r; rr < Math.min(r + rowSpan, tl.rowHeights.length); rr++) {
        const frags = rowFrags.get(rr);
        if (!frags) continue;
        for (const frag of frags) {
          rects.push({ x, y: frag.y, width, height: frag.height });
        }
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

  /**
   * The un-snapped position the current gesture anchored at, or `null`
   * when the anchor was not set by a pointer press (word/paragraph snap,
   * a programmatic range) and so has no rawer form.
   *
   * `expandRangeForLinks` may move the stored anchor outward to cover a
   * partially-selected link. Recomputing the snap from that moved anchor
   * would make it a one-way ratchet — dragging back out of the link could
   * not un-snap, and the anchor's correct snap *direction* depends on
   * where the focus is now, which the snapped value no longer records.
   * Drag and shift+click therefore snap from `rawAnchor` when it is set.
   *
   * `setRange` clears it, so any write that is not part of a pointer
   * gesture — select-all, a restored cursor, `updateDragSelection`'s
   * "mouse left the table" branch, which deliberately rewrites the anchor
   * to the table block — invalidates it by default. The pointer paths
   * re-assign it immediately after their own `setRange`.
   */
  rawAnchor: DocPosition | null = null;

  /**
   * Store a range. Endpoints are kept as given, so an endpoint that
   * carries a `lineAffinity` (a click or caret move that landed on a
   * visual wrap boundary) keeps it all the way to `buildRects`.
   */
  setRange(range: DocRange | null): void {
    this.range = range;
    this.rawAnchor = null;
  }

  hasSelection(): boolean {
    if (!this.range) return false;
    if (this.range.tableCellRange) return true;
    return (
      this.range.anchor.blockId !== this.range.focus.blockId ||
      this.range.anchor.offset !== this.range.focus.offset
    );
  }

  /**
   * Order the range into `{ start, end }`. Only the ordering changes —
   * each endpoint (and so its `lineAffinity`) is returned as stored, so a
   * backwards selection carries the focus's affinity into `start`.
   */
  /**
   * `budgetCells` bounds the merge expansion, and defaults to exact because
   * most callers *act* on the rectangle they get back — clear its cells, copy
   * them, merge them — where a rectangle that stopped growing early is a
   * merged cell half-cleared rather than a merge painted short.
   *
   * A caller that reads only `start`/`end`, or uses the rectangle to pick a
   * cell to *read* a style from, owes no such exactness and should pass
   * `MAX_MERGE_EXPANSION_CELLS`: the table is a peer's to size, the expansion
   * is superlinear in it, and those callers run per keystroke. See
   * `MAX_MERGE_EXPANSION_CELLS`.
   */
  getNormalizedRange(
    layout: DocumentLayout,
    budgetCells = Infinity,
  ): NormalizedRange | null {
    if (!this.range || !this.hasSelection()) return null;
    return normalizeRange(this.range, layout, budgetCells);
  }

  getSelectionRects(
    paginatedLayout: PaginatedLayout,
    layout: DocumentLayout,
    measurer: TextMeasurer,
    canvasWidth: number,
  ): Array<{ x: number; y: number; width: number; height: number }> {
    if (!this.range || !this.hasSelection()) return [];
    return computeSelectionRects(this.range, paginatedLayout, layout, measurer, canvasWidth);
  }

  getSelectedText(layout: DocumentLayout): string {
    const normalized = this.getNormalizedRange(layout);
    if (!normalized) return '';

    // Cell-range selection: tab-separated columns, newline-separated rows
    if (normalized.tableCellRange) {
      const cr = normalized.tableCellRange;
      // Same nested-aware lookup `normalizeRange` and `getSelectedTableCells`
      // use: a nested table block is not a member of `layout.blocks`, so the
      // flat lookup alone returned '' and copy (and cut) wrote an empty
      // `text/plain` flavour for every nested-table cell rectangle (#1049).
      const td =
        layout.blocks.find((b) => b.block.id === cr.blockId)?.block.tableData ??
        resolveNestedTableLayout(cr.blockId, layout)?.dataBlock.tableData;
      if (!td) return '';
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
      // Nested-aware for the same reason as the cell-range branch above: an
      // ordinary text selection inside a *nested* table's cell copied as ''.
      const tableData =
        layout.blocks.find((b) => b.block.id === startCellInfo.tableBlockId)
          ?.block.tableData ??
        resolveNestedTableLayout(startCellInfo.tableBlockId, layout)
          ?.dataBlock.tableData;
      if (!tableData) return '';
      const cell = tableData.rows[startCellInfo.rowIndex]
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
