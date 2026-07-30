import { describe, it, expect } from 'vitest';
import { Doc } from '../../src/model/document.js';
import { createTableBlock, createBlock } from '../../src/model/types.js';
import type { Block } from '../../src/model/types.js';
import { cloneBlockWithFreshIds } from '../../src/store/block-helpers.js';

/** Collect every block id in a (possibly nested) table block. */
function collectIds(block: Block): string[] {
  const ids = [block.id];
  if (block.tableData) {
    for (const row of block.tableData.rows) {
      for (const cell of row.cells) {
        for (const b of cell.blocks) ids.push(...collectIds(b));
      }
    }
  }
  return ids;
}

describe('cloneBlockWithFreshIds', () => {
  it('regenerates the table id and every nested cell block id', () => {
    const table = createTableBlock(2, 2);
    const origIds = collectIds(table);
    const clone = cloneBlockWithFreshIds(table);
    const cloneIds = collectIds(clone);

    // Every id is new — no overlap with the source (so the paste is
    // independent and editing one table can't leak into the other).
    for (const id of cloneIds) {
      expect(origIds).not.toContain(id);
    }
    // Same structure and count of ids.
    expect(cloneIds.length).toBe(origIds.length);
    expect(clone.type).toBe('table');
    expect(clone.tableData!.rows.length).toBe(2);
    expect(clone.tableData!.rows[0].cells.length).toBe(2);
  });

  it('regenerates ids recursively for a table nested inside a cell', () => {
    const outer = createTableBlock(1, 1);
    const inner = createTableBlock(1, 1);
    outer.tableData!.rows[0].cells[0].blocks.push(inner);

    const origIds = collectIds(outer);
    const clone = cloneBlockWithFreshIds(outer);
    const cloneIds = collectIds(clone);

    for (const id of cloneIds) {
      expect(origIds).not.toContain(id);
    }
    expect(cloneIds.length).toBe(origIds.length);
  });

  it('does not mutate the source block', () => {
    const table = createTableBlock(1, 1);
    const before = JSON.stringify(table);
    cloneBlockWithFreshIds(table);
    expect(JSON.stringify(table)).toBe(before);
  });
});

describe('Doc.insertBlockAfter (cell-aware)', () => {
  it('nests a table into a cell when the sibling block is inside that cell', () => {
    const doc = Doc.create();
    const outerId = doc.insertTable(0, 2, 2);
    const cellBlockId = doc.getBlock(outerId).tableData!.rows[0].cells[0].blocks[0].id;

    const inner = createTableBlock(2, 2);
    doc.insertBlockAfter(cellBlockId, inner);

    // The inner table now lives in cell (0,0) of the outer table, not at
    // the top level of the document.
    const cell = doc.getBlock(outerId).tableData!.rows[0].cells[0];
    expect(cell.blocks.some((b) => b.id === inner.id && b.type === 'table')).toBe(true);
    expect(doc.document.blocks.some((b) => b.id === inner.id)).toBe(false);
  });

  it('inserts after a top-level block for the body case', () => {
    const doc = Doc.create();
    const firstId = doc.document.blocks[0].id;
    const table = createTableBlock(2, 2);

    doc.insertBlockAfter(firstId, table);

    const idx = doc.document.blocks.findIndex((b) => b.id === firstId);
    expect(doc.document.blocks[idx + 1].id).toBe(table.id);
    expect(doc.document.blocks[idx + 1].type).toBe('table');
  });
});

describe('multi-block paste into a cell (primitive composition)', () => {
  it('Doc.splitBlock on a block inside a cell places the tail in the same cell', () => {
    const doc = Doc.create();
    const outerId = doc.insertTable(0, 2, 2);
    const cellBlockId = doc.getBlock(outerId).tableData!.rows[0].cells[0].blocks[0].id;

    const tailId = doc.splitBlock(cellBlockId, 0);

    const cell = doc.getBlock(outerId).tableData!.rows[0].cells[0];
    expect(cell.blocks.some((b) => b.id === tailId)).toBe(true);
    // Not leaked to the document body.
    expect(doc.document.blocks.some((b) => b.id === tailId)).toBe(false);
  });

  it('chaining insertBlockAfter after a split threads [paragraph, table, paragraph] into a cell in order', () => {
    // Model-level equivalent of pasting a multi-block table selection into a
    // cell: split at the caret, then chain the middle blocks between head and
    // tail via the cell-aware insertBlockAfter.
    const doc = Doc.create();
    const outerId = doc.insertTable(0, 2, 2);
    const headId = doc.getBlock(outerId).tableData!.rows[0].cells[0].blocks[0].id;

    const tailId = doc.splitBlock(headId, 0);

    const para = createBlock('paragraph');
    const innerTable = createTableBlock(2, 2);
    let prevId = headId;
    for (const b of [para, innerTable]) {
      doc.insertBlockAfter(prevId, b);
      prevId = b.id;
    }

    const cell = doc.getBlock(outerId).tableData!.rows[0].cells[0];
    expect(cell.blocks.map((b) => b.id)).toEqual([headId, para.id, innerTable.id, tailId]);
    // Nothing leaked to the body.
    for (const id of [para.id, innerTable.id, tailId]) {
      expect(doc.document.blocks.some((b) => b.id === id)).toBe(false);
    }
  });
});

describe('Doc.getBlock resolves freshly pasted nested-table content (#333)', () => {
  it('resolves a block inside a pasted nested table that is not yet in the parent map', () => {
    // #333's repro: the deepest level of a pasted nested table rejected the
    // caret outright. Root cause was that a block created by paste — e.g. the
    // inner table's own cell content — isn't in `_blockParentMap` yet (that
    // map is only rebuilt at the next layout pass), so `Doc.getBlock` needs
    // its `walkCellsForBlock` recursive fallback to find it at all.
    const doc = Doc.create();
    const outerId = doc.insertTable(0, 1, 1);
    const targetCellBlockId = doc.getBlock(outerId).tableData!.rows[0].cells[0].blocks[0].id;

    // Simulate a layout pass that ran before the paste: the parent map knows
    // about the pre-existing cell content, but nothing pasted after it.
    doc.setBlockParentMap(
      new Map([[targetCellBlockId, { tableBlockId: outerId, rowIndex: 0, colIndex: 0 }]]),
    );

    // Simulate pasting a table-with-a-nested-table into that cell: clone with
    // fresh ids (as the real paste path does via `cloneBlockWithFreshIds`)
    // and insert into the target cell via the cell-aware primitive.
    const sourceOuter = createTableBlock(1, 1);
    const sourceInner = createTableBlock(1, 1);
    sourceOuter.tableData!.rows[0].cells[0].blocks.push(sourceInner);
    const pasted = cloneBlockWithFreshIds(sourceOuter);
    doc.insertBlockAfter(targetCellBlockId, pasted);

    // The pasted nested table's own cell block was never added to the parent
    // map (no layout ran after the paste) — getBlock must still resolve it,
    // not throw "Block not found". Cell blocks start with a default
    // paragraph (`createTableCell`), so the pushed inner table is index 1.
    const pastedInnerTable = pasted.tableData!.rows[0].cells[0].blocks[1];
    const deepestBlockId = pastedInnerTable.tableData!.rows[0].cells[0].blocks[0].id;

    expect(() => doc.getBlock(deepestBlockId)).not.toThrow();
    expect(doc.getBlock(deepestBlockId).id).toBe(deepestBlockId);
  });
});
