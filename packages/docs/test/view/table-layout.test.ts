import { describe, it, expect } from 'vitest';
import { computeTableLayout } from '../../src/view/table-layout.js';
import { createTableBlock } from '../../src/model/types.js';

function stubCtx(): CanvasRenderingContext2D {
  return {
    font: '',
    measureText: (text: string) => ({ width: text.length * 7 }),
  } as unknown as CanvasRenderingContext2D;
}

describe('computeTableLayout', () => {
  it('should compute column pixel widths from ratios', () => {
    const block = createTableBlock(2, 3);
    const result = computeTableLayout(block.tableData!, 'test-table', stubCtx(), 300);
    expect(result.columnPixelWidths).toHaveLength(3);
    expect(result.columnPixelWidths[0]).toBeCloseTo(100);
  });

  it('should compute row heights based on cell content', () => {
    const block = createTableBlock(2, 2);
    block.tableData!.rows[0].cells[0].blocks[0].inlines = [{ text: 'Hello', style: {} }];
    const result = computeTableLayout(block.tableData!, 'test-table', stubCtx(), 200);
    expect(result.rowHeights[0]).toBeGreaterThan(0);
    expect(result.rowHeights[1]).toBeGreaterThan(0);
  });

  it('should mark merged cells', () => {
    const block = createTableBlock(2, 2);
    const td = block.tableData!;
    td.rows[0].cells[0].colSpan = 2;
    td.rows[0].cells[1].colSpan = 0;
    td.rows[0].cells[1].blocks = [];
    const result = computeTableLayout(td, 'test-table', stubCtx(), 200);
    expect(result.cells[0][0].merged).toBe(false);
    expect(result.cells[0][1].merged).toBe(true);
  });

  it('should compute cumulative X and Y offsets', () => {
    const block = createTableBlock(2, 2);
    block.tableData!.columnWidths = [0.4, 0.6];
    const result = computeTableLayout(block.tableData!, 'test-table', stubCtx(), 100);
    expect(result.columnXOffsets[0]).toBe(0);
    expect(result.columnXOffsets[1]).toBeCloseTo(40);
    expect(result.rowYOffsets[0]).toBe(0);
    expect(result.rowYOffsets[1]).toBeGreaterThan(0);
  });
});
