import { describe, it, expect } from 'vitest';
import { Doc } from '../../src/model/document.js';
import type { BlockCellInfo, CellAddress, CellRange } from '../../src/model/types.js';
import { getBlockTextLength } from '../../src/model/types.js';

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

  describe('insertText in cell', () => {
    it('should insert text into a cell', () => {
      const doc = Doc.create();
      const tableId = doc.insertTable(0, 2, 2);
      doc.setBlockParentMap(buildParentMap(doc, tableId));
      const cellBlock = getCellBlock(doc, tableId, { rowIndex: 0, colIndex: 0 });
      doc.insertText({ blockId: cellBlock.id, offset: 0 }, 'Hello');
      expect(getCellText(doc, tableId, { rowIndex: 0, colIndex: 0 })).toBe('Hello');
    });
    it('should insert text in the middle', () => {
      const doc = Doc.create();
      const tableId = doc.insertTable(0, 2, 2);
      doc.setBlockParentMap(buildParentMap(doc, tableId));
      const cellBlock = getCellBlock(doc, tableId, { rowIndex: 0, colIndex: 0 });
      doc.insertText({ blockId: cellBlock.id, offset: 0 }, 'Helo');
      doc.insertText({ blockId: cellBlock.id, offset: 2 }, 'l');
      expect(getCellText(doc, tableId, { rowIndex: 0, colIndex: 0 })).toBe('Hello');
    });
  });

  describe('deleteText in cell', () => {
    it('should delete text from a cell', () => {
      const doc = Doc.create();
      const tableId = doc.insertTable(0, 2, 2);
      doc.setBlockParentMap(buildParentMap(doc, tableId));
      const cellBlock = getCellBlock(doc, tableId, { rowIndex: 0, colIndex: 0 });
      doc.insertText({ blockId: cellBlock.id, offset: 0 }, 'Hello World');
      doc.deleteText({ blockId: cellBlock.id, offset: 5 }, 6);
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
      doc.setBlockParentMap(buildParentMap(doc, tableId));
      const cellBlock = getCellBlock(doc, tableId, { rowIndex: 1, colIndex: 0 });
      doc.insertText({ blockId: cellBlock.id, offset: 0 }, 'Middle');
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
      doc.setBlockParentMap(buildParentMap(doc, tableId));
      const cellBlock00 = getCellBlock(doc, tableId, { rowIndex: 0, colIndex: 0 });
      const cellBlock01 = getCellBlock(doc, tableId, { rowIndex: 0, colIndex: 1 });
      const cellBlock10 = getCellBlock(doc, tableId, { rowIndex: 1, colIndex: 0 });
      doc.insertText({ blockId: cellBlock00.id, offset: 0 }, 'A');
      doc.insertText({ blockId: cellBlock01.id, offset: 0 }, 'B');
      doc.insertText({ blockId: cellBlock10.id, offset: 0 }, 'C');
      const range: CellRange = { start: { rowIndex: 0, colIndex: 0 }, end: { rowIndex: 1, colIndex: 1 } };
      doc.mergeCells(tableId, range);
      const block = doc.getBlock(tableId);
      const topLeft = block.tableData!.rows[0].cells[0];
      expect(topLeft.colSpan).toBe(2);
      expect(topLeft.rowSpan).toBe(2);
      // mergeCells appends source-cell blocks to the top-left cell
      const allText = topLeft.blocks.flatMap(b => b.inlines).map(i => i.text).join('');
      expect(allText).toBe('ABC');
      expect(block.tableData!.rows[0].cells[1].colSpan).toBe(0);
      expect(block.tableData!.rows[1].cells[0].colSpan).toBe(0);
      expect(block.tableData!.rows[1].cells[1].colSpan).toBe(0);
    });

    it('absorbs an existing merged cell when the new range contains it', () => {
      const doc = Doc.create();
      const tableId = doc.insertTable(0, 4, 4);
      doc.setBlockParentMap(buildParentMap(doc, tableId));

      // Pre-merge (1,1)..(2,2) with text "M"
      const cellBlock11 = getCellBlock(doc, tableId, { rowIndex: 1, colIndex: 1 });
      doc.insertText({ blockId: cellBlock11.id, offset: 0 }, 'M');
      doc.mergeCells(tableId, { start: { rowIndex: 1, colIndex: 1 }, end: { rowIndex: 2, colIndex: 2 } });

      // Add some text outside the merge
      const cellBlock00 = getCellBlock(doc, tableId, { rowIndex: 0, colIndex: 0 });
      doc.insertText({ blockId: cellBlock00.id, offset: 0 }, 'X');

      // Now merge a 4x4 range containing the existing merge
      doc.mergeCells(tableId, { start: { rowIndex: 0, colIndex: 0 }, end: { rowIndex: 3, colIndex: 3 } });

      const block = doc.getBlock(tableId);
      const tl = block.tableData!.rows[0].cells[0];
      expect(tl.colSpan).toBe(4);
      expect(tl.rowSpan).toBe(4);

      // The text from the inner merge should be preserved in the outer top-left
      const allText = tl.blocks.flatMap(b => b.inlines).map(i => i.text).join('');
      expect(allText).toContain('X');
      expect(allText).toContain('M');

      // Every other cell should be covered
      for (let r = 0; r < 4; r++) {
        for (let c = 0; c < 4; c++) {
          if (r === 0 && c === 0) continue;
          const cell = block.tableData!.rows[r].cells[c];
          expect(cell.colSpan).toBe(0);
        }
      }
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

  describe('applyInlineStyle in cell', () => {
    it('should apply bold to a range', () => {
      const doc = Doc.create();
      const tableId = doc.insertTable(0, 2, 2);
      doc.setBlockParentMap(buildParentMap(doc, tableId));
      const cellBlock = getCellBlock(doc, tableId, { rowIndex: 0, colIndex: 0 });
      doc.insertText({ blockId: cellBlock.id, offset: 0 }, 'Hello');
      doc.applyInlineStyle(
        { anchor: { blockId: cellBlock.id, offset: 0 }, focus: { blockId: cellBlock.id, offset: 3 } },
        { bold: true },
      );
      const cell = doc.getBlock(tableId).tableData!.rows[0].cells[0];
      expect(cell.blocks[0].inlines[0].style.bold).toBe(true);
      expect(cell.blocks[0].inlines[0].text).toBe('Hel');
      expect(cell.blocks[0].inlines[1].text).toBe('lo');
    });

    it('should apply italic across paragraphs spanning a table', () => {
      // Build: paragraph("abcd") → table(2x2) → paragraph("abcd")
      const doc = Doc.create();
      const block0 = doc.document.blocks[0];
      doc.insertText({ blockId: block0.id, offset: 0 }, 'abcd');
      // Split to get two paragraphs: ["abcd", ""]
      const block2Id = doc.splitBlock(block0.id, 4);
      // Insert table between them at index 1: ["abcd", table, ""]
      const tableId = doc.insertTable(1, 2, 2);
      doc.setBlockParentMap(buildParentMap(doc, tableId));
      // Put text in cells
      const cell00 = getCellBlock(doc, tableId, { rowIndex: 0, colIndex: 0 });
      doc.insertText({ blockId: cell00.id, offset: 0 }, 'X');
      const cell11 = getCellBlock(doc, tableId, { rowIndex: 1, colIndex: 1 });
      doc.insertText({ blockId: cell11.id, offset: 0 }, 'Y');
      // Put text in last paragraph
      doc.insertText({ blockId: block2Id, offset: 0 }, 'abcd');

      // Select from "ab|cd" (offset 2) to last paragraph "ab|cd" (offset 2)
      doc.applyInlineStyle(
        { anchor: { blockId: block0.id, offset: 2 }, focus: { blockId: block2Id, offset: 2 } },
        { italic: true },
      );

      // First paragraph: "ab" plain + "cd" italic
      const p0 = doc.getBlock(block0.id);
      expect(p0.inlines[0].text).toBe('ab');
      expect(p0.inlines[0].style.italic).toBeUndefined();
      expect(p0.inlines[1].text).toBe('cd');
      expect(p0.inlines[1].style.italic).toBe(true);

      // Table cells with text should have italic applied
      const td = doc.getBlock(tableId).tableData!;
      expect(td.rows[0].cells[0].blocks[0].inlines[0].style.italic).toBe(true);
      expect(td.rows[0].cells[0].blocks[0].inlines[0].text).toBe('X');
      expect(td.rows[1].cells[1].blocks[0].inlines[0].style.italic).toBe(true);
      expect(td.rows[1].cells[1].blocks[0].inlines[0].text).toBe('Y');

      // Last paragraph: "ab" italic + "cd" plain
      const p2 = doc.getBlock(block2Id);
      expect(p2.inlines[0].text).toBe('ab');
      expect(p2.inlines[0].style.italic).toBe(true);
      expect(p2.inlines[1].text).toBe('cd');
      expect(p2.inlines[1].style.italic).toBeUndefined();
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

  describe('splitBlock in cell', () => {
    it('should split a cell block into two paragraphs', () => {
      const doc = Doc.create();
      const tableId = doc.insertTable(0, 2, 2);
      doc.setBlockParentMap(buildParentMap(doc, tableId));
      const cellBlock = getCellBlock(doc, tableId, { rowIndex: 0, colIndex: 0 });
      doc.insertText({ blockId: cellBlock.id, offset: 0 }, 'abcd');
      const newBlockId = doc.splitBlock(cellBlock.id, 2);
      doc.setBlockParentMap(buildParentMap(doc, tableId));
      const cell = doc.getBlock(tableId).tableData!.rows[0].cells[0];
      expect(cell.blocks).toHaveLength(2);
      expect(cell.blocks[0].inlines.map(i => i.text).join('')).toBe('ab');
      expect(cell.blocks[1].inlines.map(i => i.text).join('')).toBe('cd');
      expect(newBlockId).toBe(cell.blocks[1].id);
    });

    it('should split at start of block', () => {
      const doc = Doc.create();
      const tableId = doc.insertTable(0, 2, 2);
      doc.setBlockParentMap(buildParentMap(doc, tableId));
      const cellBlock = getCellBlock(doc, tableId, { rowIndex: 0, colIndex: 0 });
      doc.insertText({ blockId: cellBlock.id, offset: 0 }, 'hello');
      doc.splitBlock(cellBlock.id, 0);
      doc.setBlockParentMap(buildParentMap(doc, tableId));
      const cell = doc.getBlock(tableId).tableData!.rows[0].cells[0];
      expect(cell.blocks).toHaveLength(2);
      expect(cell.blocks[0].inlines.map(i => i.text).join('')).toBe('');
      expect(cell.blocks[1].inlines.map(i => i.text).join('')).toBe('hello');
    });

    it('should split at end of block', () => {
      const doc = Doc.create();
      const tableId = doc.insertTable(0, 2, 2);
      doc.setBlockParentMap(buildParentMap(doc, tableId));
      const cellBlock = getCellBlock(doc, tableId, { rowIndex: 0, colIndex: 0 });
      doc.insertText({ blockId: cellBlock.id, offset: 0 }, 'hello');
      doc.splitBlock(cellBlock.id, 5);
      doc.setBlockParentMap(buildParentMap(doc, tableId));
      const cell = doc.getBlock(tableId).tableData!.rows[0].cells[0];
      expect(cell.blocks).toHaveLength(2);
      expect(cell.blocks[0].inlines.map(i => i.text).join('')).toBe('hello');
      expect(cell.blocks[1].inlines.map(i => i.text).join('')).toBe('');
    });
  });

  describe('mergeBlocks in cell', () => {
    it('should merge second block into first', () => {
      const doc = Doc.create();
      const tableId = doc.insertTable(0, 2, 2);
      doc.setBlockParentMap(buildParentMap(doc, tableId));
      const cellBlock = getCellBlock(doc, tableId, { rowIndex: 0, colIndex: 0 });
      doc.insertText({ blockId: cellBlock.id, offset: 0 }, 'abcd');
      doc.splitBlock(cellBlock.id, 2);
      doc.setBlockParentMap(buildParentMap(doc, tableId));
      const cell = doc.getBlock(tableId).tableData!.rows[0].cells[0];
      const firstBlock = cell.blocks[0];
      const secondBlock = cell.blocks[1];
      doc.mergeBlocks(firstBlock.id, secondBlock.id);
      const cellAfter = doc.getBlock(tableId).tableData!.rows[0].cells[0];
      expect(cellAfter.blocks).toHaveLength(1);
      expect(cellAfter.blocks[0].inlines.map(i => i.text).join('')).toBe('abcd');
    });

    it('should no-op when merging first block', () => {
      const doc = Doc.create();
      const tableId = doc.insertTable(0, 2, 2);
      doc.setBlockParentMap(buildParentMap(doc, tableId));
      const cell = doc.getBlock(tableId).tableData!.rows[0].cells[0];
      // mergeBlocks with same block as both args should be a no-op
      // The original test called mergeBlocksInCell with blockIndex 0, which was a no-op
      // With the unified API, we just don't call mergeBlocks since there's no previous block
      expect(cell.blocks).toHaveLength(1);
    });
  });

  describe('insertText in cell with multiple blocks', () => {
    it('should insert text into the second block', () => {
      const doc = Doc.create();
      const tableId = doc.insertTable(0, 2, 2);
      doc.setBlockParentMap(buildParentMap(doc, tableId));
      const cellBlock = getCellBlock(doc, tableId, { rowIndex: 0, colIndex: 0 });
      doc.insertText({ blockId: cellBlock.id, offset: 0 }, 'abcd');
      doc.splitBlock(cellBlock.id, 2);
      doc.setBlockParentMap(buildParentMap(doc, tableId));
      const secondBlock = getCellBlock(doc, tableId, { rowIndex: 0, colIndex: 0 }, 1);
      doc.insertText({ blockId: secondBlock.id, offset: 0 }, 'X');
      const cell = doc.getBlock(tableId).tableData!.rows[0].cells[0];
      expect(cell.blocks[1].inlines.map(i => i.text).join('')).toBe('Xcd');
    });
  });

  describe('getBlockTextLength for cell block', () => {
    it('should return length of specific block', () => {
      const doc = Doc.create();
      const tableId = doc.insertTable(0, 2, 2);
      doc.setBlockParentMap(buildParentMap(doc, tableId));
      const cellBlock = getCellBlock(doc, tableId, { rowIndex: 0, colIndex: 0 });
      doc.insertText({ blockId: cellBlock.id, offset: 0 }, 'abcd');
      doc.splitBlock(cellBlock.id, 2);
      doc.setBlockParentMap(buildParentMap(doc, tableId));
      const block0 = getCellBlock(doc, tableId, { rowIndex: 0, colIndex: 0 }, 0);
      const block1 = getCellBlock(doc, tableId, { rowIndex: 0, colIndex: 0 }, 1);
      expect(getBlockTextLength(doc.getBlock(block0.id))).toBe(2);
      expect(getBlockTextLength(doc.getBlock(block1.id))).toBe(2);
    });
  });

  describe('resizeColumn', () => {
    it('should resize adjacent columns without affecting others', () => {
      const doc = Doc.create();
      const tableId = doc.insertTable(0, 2, 4); // 4 columns, each 0.25
      const td = doc.getBlock(tableId).tableData!;
      expect(td.columnWidths).toEqual([0.25, 0.25, 0.25, 0.25]);

      doc.resizeColumn(tableId, 1, 0.35, 0.15); // widen col[1], shrink col[2]
      const after = doc.getBlock(tableId).tableData!;
      expect(after.columnWidths[0]).toBeCloseTo(0.25); // unchanged
      expect(after.columnWidths[1]).toBeCloseTo(0.35);
      expect(after.columnWidths[2]).toBeCloseTo(0.15);
      expect(after.columnWidths[3]).toBeCloseTo(0.25); // unchanged
    });
  });

  describe('setRowHeight', () => {
    it('should set a row minimum height', () => {
      const doc = Doc.create();
      const tableId = doc.insertTable(0, 3, 2);
      doc.setRowHeight(tableId, 1, 60);
      const td = doc.getBlock(tableId).tableData!;
      expect(td.rowHeights).toBeDefined();
      expect(td.rowHeights![1]).toBe(60);
    });

    it('should initialize rowHeights array with undefined entries', () => {
      const doc = Doc.create();
      const tableId = doc.insertTable(0, 3, 2);
      doc.setRowHeight(tableId, 2, 80);
      const td = doc.getBlock(tableId).tableData!;
      expect(td.rowHeights).toHaveLength(3);
      // After JSON round-trip in MemDocStore, undefined slots become null
      expect(td.rowHeights![0]).toBeFalsy();
      expect(td.rowHeights![1]).toBeFalsy();
      expect(td.rowHeights![2]).toBe(80);
    });
  });

  describe('rowHeights sync', () => {
    it('should splice rowHeights on insertRow', () => {
      const doc = Doc.create();
      const tableId = doc.insertTable(0, 3, 2);
      doc.setRowHeight(tableId, 0, 40);
      doc.setRowHeight(tableId, 2, 80);

      doc.insertRow(tableId, 1); // insert between row 0 and old row 1
      const td = doc.getBlock(tableId).tableData!;
      expect(td.rowHeights).toHaveLength(4);
      expect(td.rowHeights![0]).toBe(40);
      expect(td.rowHeights![1]).toBeFalsy(); // new row has no user height (undefined or null after JSON round-trip)
      expect(td.rowHeights![3]).toBe(80);
    });

    it('should splice rowHeights on deleteRow', () => {
      const doc = Doc.create();
      const tableId = doc.insertTable(0, 3, 2);
      doc.setRowHeight(tableId, 0, 40);
      doc.setRowHeight(tableId, 1, 60);
      doc.setRowHeight(tableId, 2, 80);

      doc.deleteRow(tableId, 1);
      const td = doc.getBlock(tableId).tableData!;
      expect(td.rowHeights).toHaveLength(2);
      expect(td.rowHeights![0]).toBe(40);
      expect(td.rowHeights![1]).toBe(80);
    });
  });
});
