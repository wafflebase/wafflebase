import { describe, it, expect, beforeEach } from 'vitest';
import { Doc } from '../../src/model/document.js';
import type { CellAddress } from '../../src/model/types.js';

describe('Table cell selection helpers', () => {
  let doc: Doc;
  let tableBlockId: string;

  beforeEach(() => {
    doc = Doc.create();
    // Create a 3x3 table (Doc.create() starts with one empty paragraph at index 0;
    // insert the table at index 1 so both blocks exist)
    tableBlockId = doc.insertTable(1, 3, 3);

    // Put text in cells: "hello" in (0,0), "world" in (0,1), "foo bar" in (1,0)
    const ca00: CellAddress = { rowIndex: 0, colIndex: 0 };
    const ca01: CellAddress = { rowIndex: 0, colIndex: 1 };
    const ca10: CellAddress = { rowIndex: 1, colIndex: 0 };
    doc.insertTextInCell(tableBlockId, ca00, 0, 'hello');
    doc.insertTextInCell(tableBlockId, ca01, 0, 'world');
    doc.insertTextInCell(tableBlockId, ca10, 0, 'foo bar');
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
      const ca00: CellAddress = { rowIndex: 0, colIndex: 0 };
      doc.deleteTextInCell(tableBlockId, ca00, 1, 3); // delete "ell"
      const block = doc.getBlock(tableBlockId);
      const text = block.tableData!.rows[0].cells[0].blocks.flatMap(b => b.inlines).map(i => i.text).join('');
      expect(text).toBe('ho');
    });

    it('deletes text at start of cell', () => {
      const ca00: CellAddress = { rowIndex: 0, colIndex: 0 };
      doc.deleteTextInCell(tableBlockId, ca00, 0, 2); // delete "he"
      const block = doc.getBlock(tableBlockId);
      const text = block.tableData!.rows[0].cells[0].blocks.flatMap(b => b.inlines).map(i => i.text).join('');
      expect(text).toBe('llo');
    });

    it('deletes text at end of cell', () => {
      const ca00: CellAddress = { rowIndex: 0, colIndex: 0 };
      doc.deleteTextInCell(tableBlockId, ca00, 3, 2); // delete "lo"
      const block = doc.getBlock(tableBlockId);
      const text = block.tableData!.rows[0].cells[0].blocks.flatMap(b => b.inlines).map(i => i.text).join('');
      expect(text).toBe('hel');
    });

    it('inserts text in middle of cell', () => {
      const ca00: CellAddress = { rowIndex: 0, colIndex: 0 };
      doc.insertTextInCell(tableBlockId, ca00, 2, 'XY');
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
