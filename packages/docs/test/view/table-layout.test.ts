import { describe, it, expect } from 'vitest';
import { computeTableLayout } from '../../src/view/table-layout.js';
import { computeMergedCellLineLayouts } from '../../src/view/table-renderer.js';
import { createTableBlock, DEFAULT_BLOCK_STYLE } from '../../src/model/types.js';

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

  it('should apply user-specified rowHeights as minimum', () => {
    const block = createTableBlock(2, 2);
    block.tableData!.rowHeights = [60, undefined];
    const result = computeTableLayout(block.tableData!, 'test-table', stubCtx(), 200);
    expect(result.rowHeights[0]).toBeGreaterThanOrEqual(60);
    // Row 1 should use content-based height (at least MIN_ROW_HEIGHT = 20)
    expect(result.rowHeights[1]).toBeGreaterThanOrEqual(20);
  });

  it('should not shrink row below content height even with smaller rowHeights', () => {
    const block = createTableBlock(2, 2);
    // Add enough text to make content taller than 5px
    block.tableData!.rows[0].cells[0].blocks[0].inlines = [{ text: 'Hello World Long Text', style: {} }];
    block.tableData!.rowHeights = [5, undefined]; // 5px is less than content
    const result = computeTableLayout(block.tableData!, 'test-table', stubCtx(), 50); // narrow width forces wrapping
    // Row height should be content-based, not 5px
    expect(result.rowHeights[0]).toBeGreaterThan(5);
  });

  it('should grow rows when staggered rowSpan merges redistribute content', () => {
    // 3x3 table with staggered merges:
    //   Col 0: normal row 0, merged rows 1-2
    //   Col 1: merged rows 0-1, normal row 2
    //   Col 2: normal row 0, merged rows 1-2
    const block = createTableBlock(3, 3);
    const td = block.tableData!;

    // (0,1): rowSpan=2, two blocks
    td.rows[0].cells[1].rowSpan = 2;
    td.rows[0].cells[1].blocks = [
      { id: 'b1', type: 'paragraph', inlines: [{ text: '1x2', style: {} }], style: { ...DEFAULT_BLOCK_STYLE } },
      { id: 'b2', type: 'paragraph', inlines: [{ text: '2x2', style: {} }], style: { ...DEFAULT_BLOCK_STYLE } },
    ];
    // (1,1): covered
    td.rows[1].cells[1].colSpan = 0;
    td.rows[1].cells[1].blocks = [{ id: 'b3', type: 'paragraph', inlines: [{ text: '', style: {} }], style: { ...DEFAULT_BLOCK_STYLE } }];

    // (1,0): rowSpan=2, two blocks
    td.rows[1].cells[0].rowSpan = 2;
    td.rows[1].cells[0].blocks = [
      { id: 'b4', type: 'paragraph', inlines: [{ text: '2x1', style: {} }], style: { ...DEFAULT_BLOCK_STYLE } },
      { id: 'b5', type: 'paragraph', inlines: [{ text: '3x1', style: {} }], style: { ...DEFAULT_BLOCK_STYLE } },
    ];
    // (2,0): covered
    td.rows[2].cells[0].colSpan = 0;
    td.rows[2].cells[0].blocks = [{ id: 'b6', type: 'paragraph', inlines: [{ text: '', style: {} }], style: { ...DEFAULT_BLOCK_STYLE } }];

    // (1,2): rowSpan=2, two blocks
    td.rows[1].cells[2].rowSpan = 2;
    td.rows[1].cells[2].blocks = [
      { id: 'b7', type: 'paragraph', inlines: [{ text: '2x3', style: {} }], style: { ...DEFAULT_BLOCK_STYLE } },
      { id: 'b8', type: 'paragraph', inlines: [{ text: '3x3', style: {} }], style: { ...DEFAULT_BLOCK_STYLE } },
    ];
    // (2,2): covered
    td.rows[2].cells[2].colSpan = 0;
    td.rows[2].cells[2].blocks = [{ id: 'b9', type: 'paragraph', inlines: [{ text: '', style: {} }], style: { ...DEFAULT_BLOCK_STYLE } }];

    const result = computeTableLayout(td, 'test-table', stubCtx(), 300);

    // Every redistributed line must fit within its owner row.
    const mergedCell = result.cells[1][0];
    const padding = td.rows[1].cells[0].style?.padding ?? 4;
    const lineLayouts = computeMergedCellLineLayouts(
      mergedCell.lines,
      1,
      td.rows[1].cells[0].rowSpan ?? 1,
      padding,
      result.rowYOffsets,
      result.rowHeights,
    );

    for (let i = 0; i < mergedCell.lines.length; i++) {
      const { ownerRow, runLineY } = lineLayouts[i];
      const lineBottom =
        runLineY - result.rowYOffsets[ownerRow] + mergedCell.lines[i].height + padding;
      expect(lineBottom).toBeLessThanOrEqual(result.rowHeights[ownerRow]);
    }

    // totalHeight must equal sum of all row heights
    const sumRowHeights = result.rowHeights.reduce((s, h) => s + h, 0);
    expect(result.totalHeight).toBe(sumRowHeights);
  });
});
