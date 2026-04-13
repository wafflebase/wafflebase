import { describe, it, expect } from 'vitest';
import { computeTableLayout } from '../../src/view/table-layout.js';
import { createTableBlock, createTableCell } from '../../src/model/types.js';
import type { TableData } from '../../src/model/types.js';

function stubCtx(): CanvasRenderingContext2D {
  return {
    measureText: (text: string) => ({ width: text.length * 8 }),
    font: '',
  } as unknown as CanvasRenderingContext2D;
}

function makeNestedTableData(): { outer: TableData; innerBlockId: string } {
  const innerTable = createTableBlock(2, 2);
  const outerCell00 = createTableCell();
  outerCell00.blocks.push(innerTable);
  const outerCell01 = createTableCell();
  const outerCell10 = createTableCell();
  const outerCell11 = createTableCell();
  const outer: TableData = {
    rows: [
      { cells: [outerCell00, outerCell01] },
      { cells: [outerCell10, outerCell11] },
    ],
    columnWidths: [0.5, 0.5],
  };
  return { outer, innerBlockId: innerTable.id };
}

describe('Nested table layout', () => {
  it('should compute layout for a table containing a nested table', () => {
    const { outer, innerBlockId } = makeNestedTableData();
    const ctx = stubCtx();
    const layout = computeTableLayout(outer, 'outer-table', ctx, 400);
    // Cell (0,0) should be taller than cell (0,1) due to the nested table
    expect(layout.cells[0][0].height).toBeGreaterThan(layout.cells[0][1].height);
    // The inner table block should be in blockParentMap
    const innerTableInfo = layout.blockParentMap.get(innerBlockId);
    expect(innerTableInfo).toBeDefined();
    expect(innerTableInfo!.tableBlockId).toBe('outer-table');
    expect(innerTableInfo!.rowIndex).toBe(0);
    expect(innerTableInfo!.colIndex).toBe(0);
  });

  it('should include inner table cell blocks in blockParentMap', () => {
    const { outer } = makeNestedTableData();
    const innerTable = outer.rows[0].cells[0].blocks[1]; // index 1 = nested table
    const innerCellBlockId = innerTable.tableData!.rows[0].cells[0].blocks[0].id;
    const ctx = stubCtx();
    const layout = computeTableLayout(outer, 'outer-table', ctx, 400);
    const info = layout.blockParentMap.get(innerCellBlockId);
    expect(info).toBeDefined();
    expect(info!.tableBlockId).toBe(innerTable.id);
  });

  it('should produce a LayoutLine with nestedTable for the table block', () => {
    const { outer } = makeNestedTableData();
    const ctx = stubCtx();
    const layout = computeTableLayout(outer, 'outer-table', ctx, 400);
    const cell00 = layout.cells[0][0];
    const hasNestedTableLine = cell00.lines.some((line) => line.nestedTable !== undefined);
    expect(hasNestedTableLine).toBe(true);
  });
});
