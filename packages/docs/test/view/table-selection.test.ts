import { describe, it, expect, beforeEach } from 'vitest';
import { Doc } from '../../src/model/document.js';
import type { BlockCellInfo, CellAddress } from '../../src/model/types.js';

function buildParentMap(doc: Doc, tableBlockId: string): Map<string, BlockCellInfo> {
  const map = new Map<string, BlockCellInfo>();
  const block = doc.getBlock(tableBlockId);
  if (!block.tableData) return map;
  for (let r = 0; r < block.tableData.rows.length; r++) {
    for (let c = 0; c < block.tableData.rows[r].cells.length; c++) {
      const cell = block.tableData.rows[r].cells[c];
      for (const b of cell.blocks) {
        map.set(b.id, { tableBlockId, rowIndex: r, colIndex: c });
      }
    }
  }
  return map;
}

function getCellBlock(doc: Doc, tableBlockId: string, cell: CellAddress, blockIndex = 0) {
  return doc.getBlock(tableBlockId).tableData!.rows[cell.rowIndex].cells[cell.colIndex].blocks[blockIndex];
}

describe('Table cell selection helpers', () => {
  let doc: Doc;
  let tableBlockId: string;

  beforeEach(() => {
    doc = Doc.create();
    // Create a 3x3 table (Doc.create() starts with one empty paragraph at index 0;
    // insert the table at index 1 so both blocks exist)
    tableBlockId = doc.insertTable(1, 3, 3);
    doc.setBlockParentMap(buildParentMap(doc, tableBlockId));

    // Put text in cells: "hello" in (0,0), "world" in (0,1), "foo bar" in (1,0)
    const cb00 = getCellBlock(doc, tableBlockId, { rowIndex: 0, colIndex: 0 });
    const cb01 = getCellBlock(doc, tableBlockId, { rowIndex: 0, colIndex: 1 });
    const cb10 = getCellBlock(doc, tableBlockId, { rowIndex: 1, colIndex: 0 });
    doc.insertText({ blockId: cb00.id, offset: 0 }, 'hello');
    doc.insertText({ blockId: cb01.id, offset: 0 }, 'world');
    doc.insertText({ blockId: cb10.id, offset: 0 }, 'foo bar');
  });

  describe('Doc table cell text operations', () => {
    it('inserts and retrieves cell text', () => {
      const block = doc.getBlock(tableBlockId);
      const text = block.tableData!.rows[0].cells[0].blocks.flatMap(b => b.inlines).map(i => i.text).join('');
      expect(text).toBe('hello');
    });

    it('retrieves text from different cells', () => {
      const block = doc.getBlock(tableBlockId);
      const text01 = block.tableData!.rows[0].cells[1].blocks.flatMap(b => b.inlines).map(i => i.text).join('');
      const text10 = block.tableData!.rows[1].cells[0].blocks.flatMap(b => b.inlines).map(i => i.text).join('');
      expect(text01).toBe('world');
      expect(text10).toBe('foo bar');
    });

    it('deletes text within a cell', () => {
      const cb00 = getCellBlock(doc, tableBlockId, { rowIndex: 0, colIndex: 0 });
      doc.deleteText({ blockId: cb00.id, offset: 1 }, 3); // delete "ell"
      const block = doc.getBlock(tableBlockId);
      const text = block.tableData!.rows[0].cells[0].blocks.flatMap(b => b.inlines).map(i => i.text).join('');
      expect(text).toBe('ho');
    });

    it('deletes text at start of cell', () => {
      const cb00 = getCellBlock(doc, tableBlockId, { rowIndex: 0, colIndex: 0 });
      doc.deleteText({ blockId: cb00.id, offset: 0 }, 2); // delete "he"
      const block = doc.getBlock(tableBlockId);
      const text = block.tableData!.rows[0].cells[0].blocks.flatMap(b => b.inlines).map(i => i.text).join('');
      expect(text).toBe('llo');
    });

    it('deletes text at end of cell', () => {
      const cb00 = getCellBlock(doc, tableBlockId, { rowIndex: 0, colIndex: 0 });
      doc.deleteText({ blockId: cb00.id, offset: 3 }, 2); // delete "lo"
      const block = doc.getBlock(tableBlockId);
      const text = block.tableData!.rows[0].cells[0].blocks.flatMap(b => b.inlines).map(i => i.text).join('');
      expect(text).toBe('hel');
    });

    it('inserts text in middle of cell', () => {
      const cb00 = getCellBlock(doc, tableBlockId, { rowIndex: 0, colIndex: 0 });
      doc.insertText({ blockId: cb00.id, offset: 2 }, 'XY');
      const block = doc.getBlock(tableBlockId);
      const text = block.tableData!.rows[0].cells[0].blocks.flatMap(b => b.inlines).map(i => i.text).join('');
      expect(text).toBe('heXYllo');
    });

    it('empty cell has empty text', () => {
      const block = doc.getBlock(tableBlockId);
      const text = block.tableData!.rows[2].cells[2].blocks.flatMap(b => b.inlines).map(i => i.text).join('');
      expect(text).toBe('');
    });
  });
});
