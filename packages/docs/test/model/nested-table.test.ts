import { describe, it, expect } from 'vitest';
import { Doc } from '../../src/model/document.js';
import type { BlockCellInfo, TableData } from '../../src/model/types.js';
import { createTableBlock } from '../../src/model/types.js';

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

    const innerTableId = doc.insertTableInCell(cellBlock.id, 2, 2);

    const cell = doc.getBlock(outerTableId).tableData!.rows[0].cells[0];
    expect(cell.blocks).toHaveLength(2);
    const innerBlock = cell.blocks.find((b) => b.id === innerTableId);
    expect(innerBlock).toBeDefined();
    expect(innerBlock!.type).toBe('table');
    expect(innerBlock!.tableData!.rows).toHaveLength(2);
    expect(innerBlock!.tableData!.rows[0].cells).toHaveLength(2);
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
