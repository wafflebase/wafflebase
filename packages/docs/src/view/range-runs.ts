/**
 * One shared walk over the text runs a `DocRange` covers.
 *
 * Reading a range's formatting and writing it must agree on *which runs the
 * range covers* — otherwise a toggle decides "already bold" from a different
 * set of runs than the one it then styles, which is exactly how issue #715
 * left a style impossible to re-apply. This module is that single walk:
 * `Doc.applyInlineStyle`'s dispatch (same block → same cell, multi block →
 * top level with table normalization) plus the cell-rectangle case the
 * editors handle above it.
 *
 * Every visited run is reported with its *effective* style — the block's
 * named-style inline defaults (`resolveStyleInline`) layered under the run's
 * explicit style — so a read sees the value the renderer paints. A built-in
 * heading whose named style sets `italic` reads as italic even though no run
 * carries the flag.
 *
 * Zero-width runs (empty placeholder inlines) are skipped: they carry no
 * style information and would otherwise make every empty block look "mixed".
 */
import type { Block, DocRange, Inline, InlineStyle } from '../model/types.js';
import { getBlockTextLength } from '../model/types.js';
import { blockStyleId, resolveStyleInline } from '../model/named-styles.js';
import type { Doc } from '../model/document.js';

/**
 * Called once per text run overlapping the range.
 *
 * @param style    Effective style — named-style defaults under `inline.style`.
 * @param inline   The run itself (raw `inline.style` available on it).
 * @param block    The block the run belongs to.
 */
export type StyledRunVisitor = (
  style: Partial<InlineStyle>,
  inline: Inline,
  block: Block,
) => void;

/**
 * Visit every text run the range covers, in document order.
 *
 * Mirrors `Doc.applyInlineStyle` so the runs read are the runs written.
 */
export function visitStyledRunsInRange(
  doc: Doc,
  range: DocRange,
  visit: StyledRunVisitor,
): void {
  const visitBlockSlice = (blockId: string, from: number, to: number): void => {
    const block = doc.findBlock(blockId);
    if (!block) return;
    const defaults = resolveStyleInline(blockStyleId(block), doc.document.styles);
    let pos = 0;
    for (const inline of block.inlines) {
      const inlineEnd = pos + inline.text.length;
      // Overlap test [from, to) with [pos, inlineEnd).
      if (inline.text.length > 0 && inlineEnd > from && pos < to) {
        visit({ ...defaults, ...inline.style }, inline, block);
      }
      pos = inlineEnd;
      if (pos >= to) break;
    }
  };

  const visitWholeBlock = (block: Block): void =>
    visitBlockSlice(block.id, 0, getBlockTextLength(block));

  const visitTable = (block: Block): void => {
    if (!block.tableData) return;
    for (const row of block.tableData.rows) {
      for (const cell of row.cells) {
        // colSpan 0 = a merged-away cell; its content lives in the top-left.
        if (cell.colSpan === 0) continue;
        for (const cellBlock of cell.blocks) {
          if (cellBlock.type === 'table' && cellBlock.tableData) {
            visitTable(cellBlock);
          } else {
            visitWholeBlock(cellBlock);
          }
        }
      }
    }
  };

  // Rectangle of selected cells — every block inside counts.
  if (range.tableCellRange) {
    const cr = range.tableCellRange;
    const tableBlock = doc.findBlock(cr.blockId);
    if (!tableBlock?.tableData) return;
    const minRow = Math.min(cr.start.rowIndex, cr.end.rowIndex);
    const maxRow = Math.max(cr.start.rowIndex, cr.end.rowIndex);
    const minCol = Math.min(cr.start.colIndex, cr.end.colIndex);
    const maxCol = Math.max(cr.start.colIndex, cr.end.colIndex);
    for (let r = minRow; r <= maxRow; r++) {
      for (let c = minCol; c <= maxCol; c++) {
        const cell = tableBlock.tableData.rows[r]?.cells[c];
        if (!cell || cell.colSpan === 0) continue;
        for (const cellBlock of cell.blocks) visitWholeBlock(cellBlock);
      }
    }
    return;
  }

  // Same block — works for both top-level and cell blocks.
  if (range.anchor.blockId === range.focus.blockId) {
    const a = range.anchor.offset;
    const b = range.focus.offset;
    visitBlockSlice(range.anchor.blockId, Math.min(a, b), Math.max(a, b));
    return;
  }

  // `doc.blockParentMap` is the merged body + header + footer map (the same
  // one `applyInlineStyle` reads), so header/footer cells resolve too.
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
      if (start < end) visitBlockSlice(block.id, start, end);
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
    // A table inside a cross-block selection is styled whole, so read it
    // whole (`applyInlineStyle` does the same).
    if (block.type === 'table' && block.tableData) {
      visitTable(block);
      continue;
    }
    const blockLen = getBlockTextLength(block);
    const start = i === fromIdx ? from.offset : 0;
    const end = i === toIdx ? to.offset : blockLen;
    if (start < end) visitBlockSlice(block.id, start, end);
  }
}
