import { describe, it, expect } from 'vitest';
import { Doc } from '../../src/model/document.js';
import type { CellAddress, CellRange } from '../../src/model/types.js';

function getCellText(doc: Doc, blockId: string, cell: CellAddress): string {
  const block = doc.getBlock(blockId);
  const tc = block.tableData!.rows[cell.rowIndex].cells[cell.colIndex];
  return tc.blocks.flatMap(b => b.inlines).map(i => i.text).join('');
}

describe('Doc table operations', () => {
  describe('insertTable', () => {
    it('should insert a 2x3 table at index 0', () => {
      const doc = Doc.create();
      const tableId = doc.insertTable(0, 2, 3);
      const block = doc.getBlock(tableId);
      expect(block.type).toBe('table');
      expect(block.tableData!.rows).toHaveLength(2);
      expect(block.tableData!.rows[0].cells).toHaveLength(3);
    });
  });

  describe('insertTextInCell', () => {
    it('should insert text into a cell', () => {
      const doc = Doc.create();
      const tableId = doc.insertTable(0, 2, 2);
      doc.insertTextInCell(tableId, { rowIndex: 0, colIndex: 0 }, 0, 'Hello');
      expect(getCellText(doc, tableId, { rowIndex: 0, colIndex: 0 })).toBe('Hello');
    });
    it('should insert text in the middle', () => {
      const doc = Doc.create();
      const tableId = doc.insertTable(0, 2, 2);
      doc.insertTextInCell(tableId, { rowIndex: 0, colIndex: 0 }, 0, 'Helo');
      doc.insertTextInCell(tableId, { rowIndex: 0, colIndex: 0 }, 2, 'l');
      expect(getCellText(doc, tableId, { rowIndex: 0, colIndex: 0 })).toBe('Hello');
    });
  });

  describe('deleteTextInCell', () => {
    it('should delete text from a cell', () => {
      const doc = Doc.create();
      const tableId = doc.insertTable(0, 2, 2);
      doc.insertTextInCell(tableId, { rowIndex: 0, colIndex: 0 }, 0, 'Hello World');
      doc.deleteTextInCell(tableId, { rowIndex: 0, colIndex: 0 }, 5, 6);
      expect(getCellText(doc, tableId, { rowIndex: 0, colIndex: 0 })).toBe('Hello');
    });
  });

  describe('insertRow', () => {
    it('should insert a row', () => {
      const doc = Doc.create();
      const tableId = doc.insertTable(0, 2, 3);
      doc.insertRow(tableId, 1);
      expect(doc.getBlock(tableId).tableData!.rows).toHaveLength(3);
      expect(doc.getBlock(tableId).tableData!.rows[1].cells).toHaveLength(3);
    });
  });

  describe('deleteRow', () => {
    it('should delete a row', () => {
      const doc = Doc.create();
      const tableId = doc.insertTable(0, 3, 2);
      doc.insertTextInCell(tableId, { rowIndex: 1, colIndex: 0 }, 0, 'Middle');
      doc.deleteRow(tableId, 1);
      expect(doc.getBlock(tableId).tableData!.rows).toHaveLength(2);
    });
  });

  describe('insertColumn', () => {
    it('should insert a column and renormalize widths', () => {
      const doc = Doc.create();
      const tableId = doc.insertTable(0, 2, 2);
      doc.insertColumn(tableId, 1);
      const block = doc.getBlock(tableId);
      expect(block.tableData!.columnWidths).toHaveLength(3);
      expect(block.tableData!.rows[0].cells).toHaveLength(3);
      const sum = block.tableData!.columnWidths.reduce((a, b) => a + b, 0);
      expect(sum).toBeCloseTo(1.0);
    });
  });

  describe('deleteColumn', () => {
    it('should delete a column and renormalize widths', () => {
      const doc = Doc.create();
      const tableId = doc.insertTable(0, 2, 3);
      doc.deleteColumn(tableId, 1);
      const block = doc.getBlock(tableId);
      expect(block.tableData!.columnWidths).toHaveLength(2);
      expect(block.tableData!.rows[0].cells).toHaveLength(2);
      const sum = block.tableData!.columnWidths.reduce((a, b) => a + b, 0);
      expect(sum).toBeCloseTo(1.0);
    });
  });

  describe('mergeCells', () => {
    it('should merge a 2x2 range', () => {
      const doc = Doc.create();
      const tableId = doc.insertTable(0, 3, 3);
      doc.insertTextInCell(tableId, { rowIndex: 0, colIndex: 0 }, 0, 'A');
      doc.insertTextInCell(tableId, { rowIndex: 0, colIndex: 1 }, 0, 'B');
      doc.insertTextInCell(tableId, { rowIndex: 1, colIndex: 0 }, 0, 'C');
      const range: CellRange = { start: { rowIndex: 0, colIndex: 0 }, end: { rowIndex: 1, colIndex: 1 } };
      doc.mergeCells(tableId, range);
      const block = doc.getBlock(tableId);
      const topLeft = block.tableData!.rows[0].cells[0];
      expect(topLeft.colSpan).toBe(2);
      expect(topLeft.rowSpan).toBe(2);
      expect(topLeft.blocks[0].inlines.map(i => i.text).join('')).toBe('ABC');
      expect(block.tableData!.rows[0].cells[1].colSpan).toBe(0);
      expect(block.tableData!.rows[1].cells[0].colSpan).toBe(0);
      expect(block.tableData!.rows[1].cells[1].colSpan).toBe(0);
    });
  });

  describe('splitCell', () => {
    it('should split a merged cell', () => {
      const doc = Doc.create();
      const tableId = doc.insertTable(0, 3, 3);
      const range: CellRange = { start: { rowIndex: 0, colIndex: 0 }, end: { rowIndex: 1, colIndex: 1 } };
      doc.mergeCells(tableId, range);
      doc.splitCell(tableId, { rowIndex: 0, colIndex: 0 });
      const block = doc.getBlock(tableId);
      expect(block.tableData!.rows[0].cells[0].colSpan).toBeUndefined();
      expect(block.tableData!.rows[0].cells[0].rowSpan).toBeUndefined();
      expect(block.tableData!.rows[0].cells[1].colSpan).toBeUndefined();
    });
  });

  describe('applyCellStyle', () => {
    it('should apply background color', () => {
      const doc = Doc.create();
      const tableId = doc.insertTable(0, 2, 2);
      doc.applyCellStyle(tableId, { rowIndex: 0, colIndex: 0 }, { backgroundColor: '#FF0000' });
      expect(doc.getBlock(tableId).tableData!.rows[0].cells[0].style.backgroundColor).toBe('#FF0000');
    });
  });

  describe('applyCellInlineStyle', () => {
    it('should apply bold to a range', () => {
      const doc = Doc.create();
      const tableId = doc.insertTable(0, 2, 2);
      doc.insertTextInCell(tableId, { rowIndex: 0, colIndex: 0 }, 0, 'Hello');
      doc.applyCellInlineStyle(tableId, { rowIndex: 0, colIndex: 0 }, 0, 3, { bold: true });
      const cell = doc.getBlock(tableId).tableData!.rows[0].cells[0];
      expect(cell.blocks[0].inlines[0].style.bold).toBe(true);
      expect(cell.blocks[0].inlines[0].text).toBe('Hel');
      expect(cell.blocks[0].inlines[1].text).toBe('lo');
    });
  });

  describe('setColumnWidth', () => {
    it('should update width and renormalize', () => {
      const doc = Doc.create();
      const tableId = doc.insertTable(0, 2, 3);
      doc.setColumnWidth(tableId, 0, 0.5);
      const block = doc.getBlock(tableId);
      expect(block.tableData!.columnWidths[0]).toBeCloseTo(0.5);
      const sum = block.tableData!.columnWidths.reduce((a, b) => a + b, 0);
      expect(sum).toBeCloseTo(1.0);
    });
  });
});
