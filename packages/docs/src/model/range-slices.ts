/**
 * The one traversal that decides which text a `DocRange` covers.
 *
 * Reading a range's formatting and writing it must agree on *which runs the
 * range covers* — otherwise a toggle decides "already bold" from a different
 * set of runs than the one it then styles, which is exactly how issue #715
 * left a style impossible to re-apply. Rather than keep two copies of the
 * dispatch in sync, both sides drive this module:
 *
 *  - the write, `Doc.applyInlineStyle`, whose visitor calls `store.applyStyle`
 *  - the read, `visitStyledRunsInRange` (`model/range-runs.ts`), whose visitor
 *    walks the slice's inline runs — and through it `getRangeStyleSummary`,
 *    `stepSelectionFontSize` and the keyboard toggles
 *
 * A slice is a half-open `[from, to)` character span inside one block. Empty
 * slices are never reported, so a caller never has to guard `from >= to`.
 */
import type { Block, CellAddress, DocRange } from './types.js';
import { getBlockTextLength } from './types.js';
import type { Doc } from './document.js';

/**
 * Called once per block slice the range covers, in document order.
 *
 * @param blockId The block the slice belongs to.
 * @param from    Slice start offset within the block.
 * @param to      Slice end offset within the block (exclusive, `> from`).
 */
export type RangeSliceVisitor = (
  blockId: string,
  from: number,
  to: number,
) => void;

/**
 * Visit every block slice a rectangle of selected cells covers.
 *
 * Every block of every cell counts, whole. A merged-away cell (`colSpan === 0`)
 * is skipped — its content lives in the rectangle's top-left cell. A nested
 * table block contributes nothing: `getBlockTextLength` is 0 for it, and the
 * traversal is deliberately not recursive (see `visitRangeSlices`).
 */
export function visitCellRectangleSlices(
  doc: Doc,
  cellRange: { blockId: string; start: CellAddress; end: CellAddress },
  visit: RangeSliceVisitor,
): void {
  const tableBlock = doc.findBlock(cellRange.blockId);
  if (!tableBlock?.tableData) return;
  const { rows } = tableBlock.tableData;
  // Clamped to the table's own dimensions: a stale or malformed cell range
  // would otherwise spin over indices that can only ever miss.
  const minRow = Math.max(0, Math.min(cellRange.start.rowIndex, cellRange.end.rowIndex));
  const maxRow = Math.min(rows.length - 1, Math.max(cellRange.start.rowIndex, cellRange.end.rowIndex));
  const minCol = Math.max(0, Math.min(cellRange.start.colIndex, cellRange.end.colIndex));
  const maxCol = Math.min(
    Math.max(0, ...rows.map((row) => row.cells.length)) - 1,
    Math.max(cellRange.start.colIndex, cellRange.end.colIndex),
  );
  for (let r = minRow; r <= maxRow; r++) {
    for (let c = minCol; c <= maxCol; c++) {
      const cell = rows[r]?.cells[c];
      if (!cell || cell.colSpan === 0) continue;
      for (const cellBlock of cell.blocks) visitWholeBlock(cellBlock, visit);
    }
  }
}

function visitWholeBlock(block: Block, visit: RangeSliceVisitor): void {
  const length = getBlockTextLength(block);
  if (length > 0) visit(block.id, 0, length);
}

/**
 * Visit every block slice the range covers, in document order.
 *
 * Four cases, all of which fall out of where the two endpoints live:
 *
 *  - **Same block** — one slice. Works for a top-level block and a cell block
 *    alike, so it needs no parentage lookup.
 *  - **Cross-block inside one cell** — the cell's own block list is the
 *    document order to walk.
 *  - **Top-level cross-block** — an endpoint inside a cell normalizes to its
 *    parent *table* block, then the context blocks are walked between the two
 *    indices. A table caught in between is covered whole.
 *  - **Neither** — an endpoint whose parent table is not itself a context
 *    block (an endpoint inside a *nested* table, or a parentage entry stale
 *    since the last layout) has no index to walk from; nothing is visited.
 *    Guarding here is what keeps the read and the write from disagreeing:
 *    before this, the read reported nothing while the write indexed
 *    `contextBlocks[-1]` and threw a `TypeError`.
 *
 * `range.tableCellRange` is deliberately *not* handled — a cell rectangle is a
 * different selection shape, and its callers route to
 * `visitCellRectangleSlices` above this.
 *
 * The table case is not recursive: a nested table's blocks are never visited,
 * so nested content is neither read nor written. That gap is recorded in
 * `docs/design/docs/tables/docs-nested-tables.md`; because there is only one
 * traversal, closing it would close it for the read and the write together.
 */
export function visitRangeSlices(
  doc: Doc,
  range: DocRange,
  visit: RangeSliceVisitor,
): void {
  // Same block — works for both top-level and cell blocks.
  if (range.anchor.blockId === range.focus.blockId) {
    const a = range.anchor.offset;
    const b = range.focus.offset;
    const from = Math.min(a, b);
    const to = Math.max(a, b);
    if (from < to) visit(range.anchor.blockId, from, to);
    return;
  }

  // `doc.blockParentMap` is the merged body + header + footer map, so
  // header/footer cells resolve too.
  const anchorCI = doc.blockParentMap.get(range.anchor.blockId);
  const focusCI = doc.blockParentMap.get(range.focus.blockId);

  // Cross-block inside one cell.
  if (
    anchorCI && focusCI &&
    anchorCI.tableBlockId === focusCI.tableBlockId &&
    anchorCI.rowIndex === focusCI.rowIndex &&
    anchorCI.colIndex === focusCI.colIndex
  ) {
    const tableBlock = doc.findBlock(anchorCI.tableBlockId);
    const cell =
      tableBlock?.tableData?.rows[anchorCI.rowIndex]?.cells[anchorCI.colIndex];
    if (!cell) return;
    const anchorIdx = cell.blocks.findIndex((b) => b.id === range.anchor.blockId);
    const focusIdx = cell.blocks.findIndex((b) => b.id === range.focus.blockId);
    if (anchorIdx < 0 || focusIdx < 0) return;
    const [fromIdx, toIdx, from, to] = anchorIdx <= focusIdx
      ? [anchorIdx, focusIdx, range.anchor, range.focus]
      : [focusIdx, anchorIdx, range.focus, range.anchor];
    for (let i = fromIdx; i <= toIdx; i++) {
      const block = cell.blocks[i];
      const blockLen = getBlockTextLength(block);
      const start = i === fromIdx ? from.offset : 0;
      const end = i === toIdx ? to.offset : blockLen;
      if (start < end) visit(block.id, start, end);
    }
    return;
  }

  // Top-level cross-block: normalize cell endpoints to their parent table
  // block, then walk the context blocks in document order.
  const anchorTopId = anchorCI ? anchorCI.tableBlockId : range.anchor.blockId;
  const focusTopId = focusCI ? focusCI.tableBlockId : range.focus.blockId;
  const anchorIdx = doc.getBlockIndex(anchorTopId);
  const focusIdx = doc.getBlockIndex(focusTopId);
  if (anchorIdx < 0 || focusIdx < 0) return;

  const [fromIdx, toIdx, from, to] =
    anchorIdx < focusIdx ||
    (anchorIdx === focusIdx && range.anchor.offset <= range.focus.offset)
      ? [anchorIdx, focusIdx, range.anchor, range.focus]
      : [focusIdx, anchorIdx, range.focus, range.anchor];

  const contextBlocks = doc.getContextBlocks();
  for (let i = fromIdx; i <= toIdx; i++) {
    const block = contextBlocks[i];
    if (!block) continue;
    // A table caught inside a cross-block selection is covered whole.
    if (block.type === 'table' && block.tableData) {
      for (const row of block.tableData.rows) {
        for (const cell of row.cells) {
          // colSpan 0 = a merged-away cell; its content lives in the top-left.
          if (cell.colSpan === 0) continue;
          for (const cellBlock of cell.blocks) visitWholeBlock(cellBlock, visit);
        }
      }
      continue;
    }
    const blockLen = getBlockTextLength(block);
    const start = i === fromIdx ? from.offset : 0;
    const end = i === toIdx ? to.offset : blockLen;
    if (start < end) visit(block.id, start, end);
  }
}
