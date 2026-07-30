import { describe, it, expect } from 'vitest';
import { Doc } from '../../src/model/document.js';
import { createTableBlock } from '../../src/model/types.js';
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
