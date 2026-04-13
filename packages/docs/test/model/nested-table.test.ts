import { describe, it, expect } from 'vitest';
import { Doc } from '../../src/model/document.js';
import type { BlockCellInfo, TableData } from '../../src/model/types.js';
import { createTableBlock } from '../../src/model/types.js';
import type { CellRange } from '../../src/model/types.js';

/**
 * Build a BlockParentMap that recursively walks nested tables,
 * so inner blocks map to their direct parent table.
 */
function buildParentMapRecursive(
  doc: Doc,
  tableBlockId: string,
): Map<string, BlockCellInfo> {
  const map = new Map<string, BlockCellInfo>();
  function walk(tblId: string, tableData: TableData) {
    for (let r = 0; r < tableData.rows.length; r++) {
      for (let c = 0; c < tableData.rows[r].cells.length; c++) {
        const cell = tableData.rows[r].cells[c];
        for (const b of cell.blocks) {
          map.set(b.id, { tableBlockId: tblId, rowIndex: r, colIndex: c });
          if (b.type === 'table' && b.tableData) {
            walk(b.id, b.tableData);
          }
        }
      }
    }
  }
  const block = doc.getBlock(tableBlockId);
  if (block.tableData) walk(tableBlockId, block.tableData);
  return map;
}

describe('Nested table block lookup', () => {
  /**
   * Helper: create a doc with a top-level table and nest an inner table
   * inside cell (0,0) of the outer table.
   * Returns { doc, outerTableId, innerTableId }.
   */
  function createNestedTableDoc() {
    const doc = Doc.create();
    const outerTableId = doc.insertTable(0, 2, 2);

    // Manually place an inner table into cell (0,0) of the outer table
    const outerBlock = doc.getBlock(outerTableId);
    const innerTable = createTableBlock(2, 2);
    outerBlock.tableData!.rows[0].cells[0].blocks.push(innerTable);

    // Build recursive parent map
    const map = buildParentMapRecursive(doc, outerTableId);
    doc.setBlockParentMap(map);

    return { doc, outerTableId, innerTableId: innerTable.id };
  }

  it('should find a block inside a nested table via getBlock()', () => {
    const { doc, innerTableId } = createNestedTableDoc();

    // Get a block inside the inner table's cell (0,0)
    const innerTable = doc.getBlock(innerTableId);
    expect(innerTable.type).toBe('table');
    expect(innerTable.tableData).toBeDefined();

    const innerCellBlock = innerTable.tableData!.rows[0].cells[0].blocks[0];
    const found = doc.getBlock(innerCellBlock.id);
    expect(found).toBeDefined();
    expect(found.id).toBe(innerCellBlock.id);
  });

  it('should map inner blocks to their direct parent table in BlockParentMap', () => {
    const { doc, outerTableId, innerTableId } = createNestedTableDoc();
    const map = doc.blockParentMap;

    // The inner table block itself should map to the outer table
    const innerTableInfo = map.get(innerTableId);
    expect(innerTableInfo).toBeDefined();
    expect(innerTableInfo!.tableBlockId).toBe(outerTableId);

    // A block inside the inner table should map to the inner table
    const innerTable = doc.getBlock(innerTableId);
    const innerCellBlock = innerTable.tableData!.rows[0].cells[0].blocks[0];
    const innerCellInfo = map.get(innerCellBlock.id);
    expect(innerCellInfo).toBeDefined();
    expect(innerCellInfo!.tableBlockId).toBe(innerTableId);
  });

  it('should insert a nested table into a cell via insertTableInCell', () => {
    const doc = Doc.create();
    const outerTableId = doc.insertTable(0, 2, 2);
    const outerBlock = doc.getBlock(outerTableId);
    const cellBlock = outerBlock.tableData!.rows[0].cells[0].blocks[0];
    const map = buildParentMapRecursive(doc, outerTableId);
    doc.setBlockParentMap(map);

    const innerBlock = doc.insertTableInCell(cellBlock.id, 2, 2);

    const cell = doc.getBlock(outerTableId).tableData!.rows[0].cells[0];
    expect(cell.blocks).toHaveLength(2);
    expect(cell.blocks.find((b) => b.id === innerBlock.id)).toBeDefined();
    expect(innerBlock.type).toBe('table');
    expect(innerBlock.tableData!.rows).toHaveLength(2);
    expect(innerBlock.tableData!.rows[0].cells).toHaveLength(2);
  });

  it('should insert and retrieve text in a nested table cell', () => {
    const { doc, innerTableId } = createNestedTableDoc();

    const innerTable = doc.getBlock(innerTableId);
    const innerCellBlock = innerTable.tableData!.rows[0].cells[0].blocks[0];

    doc.insertText({ blockId: innerCellBlock.id, offset: 0 }, 'Nested');

    // Re-fetch after mutation and verify
    const updated = doc.getBlock(innerCellBlock.id);
    const text = updated.inlines.map((i) => i.text).join('');
    expect(text).toBe('Nested');
  });
});

describe('Nested table navigation context', () => {
  it('getCellInfo should return inner table cell for inner block', () => {
    const doc = Doc.create();
    const outerTableId = doc.insertTable(0, 2, 2);
    const outerBlock = doc.getBlock(outerTableId);
    const innerTable = createTableBlock(2, 2);
    outerBlock.tableData!.rows[0].cells[0].blocks.push(innerTable);

    const map = buildParentMapRecursive(doc, outerTableId);
    doc.setBlockParentMap(map);

    // Inner cell (1,1) paragraph
    const innerCellBlock = innerTable.tableData!.rows[1].cells[1].blocks[0];
    const info = map.get(innerCellBlock.id);
    expect(info).toBeDefined();
    expect(info!.tableBlockId).toBe(innerTable.id);
    expect(info!.rowIndex).toBe(1);
    expect(info!.colIndex).toBe(1);
  });

  it('getCellInfo for inner table block itself should return outer cell', () => {
    const doc = Doc.create();
    const outerTableId = doc.insertTable(0, 2, 2);
    const outerBlock = doc.getBlock(outerTableId);
    const innerTable = createTableBlock(2, 2);
    outerBlock.tableData!.rows[0].cells[0].blocks.push(innerTable);

    const map = buildParentMapRecursive(doc, outerTableId);

    const info = map.get(innerTable.id);
    expect(info).toBeDefined();
    expect(info!.tableBlockId).toBe(outerTableId);
    expect(info!.rowIndex).toBe(0);
    expect(info!.colIndex).toBe(0);
  });
});

describe('Nested table integration', () => {
  it('should support row/column operations on inner table', () => {
    const doc = Doc.create();
    const outerTableId = doc.insertTable(0, 2, 2);

    // Insert inner table into cell (0,0) of outer table via insertTableInCell
    const outerBlock = doc.getBlock(outerTableId);
    const cellBlock = outerBlock.tableData!.rows[0].cells[0].blocks[0];
    const map = buildParentMapRecursive(doc, outerTableId);
    doc.setBlockParentMap(map);
    const innerTable = doc.insertTableInCell(cellBlock.id, 2, 2);

    // Rebuild the parent map to include the inner table's blocks
    const map2 = buildParentMapRecursive(doc, outerTableId);
    doc.setBlockParentMap(map2);

    // Insert row in inner table
    doc.insertRow(innerTable.id, 1);
    const updatedInner = doc.getBlock(innerTable.id);
    expect(updatedInner.tableData!.rows).toHaveLength(3);

    // Insert column in inner table
    doc.insertColumn(innerTable.id, 1);
    expect(doc.getBlock(innerTable.id).tableData!.columnWidths).toHaveLength(3);
  });

  it('should support merge/split in inner table', () => {
    const doc = Doc.create();
    const outerTableId = doc.insertTable(0, 2, 2);

    // Insert inner 3x3 table into cell (0,0) of outer table
    const outerBlock = doc.getBlock(outerTableId);
    const cellBlock = outerBlock.tableData!.rows[0].cells[0].blocks[0];
    const map = buildParentMapRecursive(doc, outerTableId);
    doc.setBlockParentMap(map);
    const innerTable = doc.insertTableInCell(cellBlock.id, 3, 3);

    // Rebuild the parent map
    const map2 = buildParentMapRecursive(doc, outerTableId);
    doc.setBlockParentMap(map2);

    // Merge cells (0,0)-(1,1) in inner table
    const mergeRange: CellRange = {
      start: { rowIndex: 0, colIndex: 0 },
      end: { rowIndex: 1, colIndex: 1 },
    };
    doc.mergeCells(innerTable.id, mergeRange);
    const updatedInner = doc.getBlock(innerTable.id);
    expect(updatedInner.tableData!.rows[0].cells[0].colSpan).toBe(2);
    expect(updatedInner.tableData!.rows[0].cells[0].rowSpan).toBe(2);

    // Split the merged cell
    doc.splitCell(innerTable.id, { rowIndex: 0, colIndex: 0 });
    const afterSplit = doc.getBlock(innerTable.id);
    expect(afterSplit.tableData!.rows[0].cells[0].colSpan).toBeUndefined();
  });

  it('should support text editing in deeply nested table (2 levels)', () => {
    const doc = Doc.create();
    const outerTableId = doc.insertTable(0, 2, 2);

    // Insert inner table into outer cell (0,0)
    const outerBlock = doc.getBlock(outerTableId);
    const outerCellBlock = outerBlock.tableData!.rows[0].cells[0].blocks[0];
    const map = buildParentMapRecursive(doc, outerTableId);
    doc.setBlockParentMap(map);
    const innerTable = doc.insertTableInCell(outerCellBlock.id, 2, 2);

    // Rebuild map to include inner table's blocks
    const map2 = buildParentMapRecursive(doc, outerTableId);
    doc.setBlockParentMap(map2);

    // Insert innermost table into inner cell (0,0)
    const innerCellBlock = innerTable.tableData!.rows[0].cells[0].blocks[0];
    const innermostTable = doc.insertTableInCell(innerCellBlock.id, 2, 2);

    // Rebuild map again to include innermost table's blocks
    const map3 = buildParentMapRecursive(doc, outerTableId);
    doc.setBlockParentMap(map3);

    // Insert text in innermost cell (0,0)
    const innermostCellBlock = innermostTable.tableData!.rows[0].cells[0].blocks[0];
    doc.insertText({ blockId: innermostCellBlock.id, offset: 0 }, 'Deep!');
    const found = doc.getBlock(innermostCellBlock.id);
    expect(found.inlines.map((i) => i.text).join('')).toBe('Deep!');
  });
});
