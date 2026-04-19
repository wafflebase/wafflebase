import { describe, it, expect } from 'vitest';
import { computeTableLayout, findRowSplitHeight } from '../../src/view/table-layout.js';
import { createTableBlock, DEFAULT_PAGE_SETUP, getEffectiveDimensions } from '../../src/model/types.js';
import { computeLayout } from '../../src/view/layout.js';
import { paginateLayout } from '../../src/view/pagination.js';

function stubCtx(): CanvasRenderingContext2D {
  return {
    font: '',
    measureText: (text: string) => ({ width: text.length * 7 }),
  } as unknown as CanvasRenderingContext2D;
}

describe('findRowSplitHeight', () => {
  it('returns safe split height for a single-cell row', () => {
    const block = createTableBlock(1, 1);
    const td = block.tableData!;
    td.rows[0].cells[0].blocks[0].inlines = [
      { text: 'Line 1 text here', style: {} },
      { text: ' and more text', style: {} },
    ];
    const ctx = stubCtx();
    const layout = computeTableLayout(td, 'tbl', ctx, 200);
    const splitH = findRowSplitHeight(layout, 0, 100);

    // Should find a split point within available height
    expect(splitH).toBeGreaterThan(0);
    expect(splitH).toBeLessThanOrEqual(100);
  });

  it('returns 0 for out-of-bounds row index', () => {
    const block = createTableBlock(1, 1);
    const td = block.tableData!;
    td.rows[0].cells[0].blocks[0].inlines = [{ text: 'hello', style: {} }];
    const ctx = stubCtx();
    const layout = computeTableLayout(td, 'tbl', ctx, 200);
    expect(findRowSplitHeight(layout, 5, 100)).toBe(0);
  });

  it('handles multi-column rows with different line heights', () => {
    const block = createTableBlock(1, 2);
    const td = block.tableData!;
    td.rows[0].cells[0].blocks[0].inlines = [{ text: 'A', style: {} }];
    td.rows[0].cells[1].blocks[0].inlines = [{ text: 'B', style: {} }];
    const ctx = stubCtx();
    const layout = computeTableLayout(td, 'tbl', ctx, 200);
    const splitH = findRowSplitHeight(layout, 0, 100);

    // Should return a safe height (min of per-cell breakpoints)
    expect(splitH).toBeGreaterThanOrEqual(0);
  });

  it('returns 0 when no line fits in available height', () => {
    const block = createTableBlock(1, 1);
    const td = block.tableData!;
    td.rows[0].cells[0].blocks[0].inlines = [{ text: 'hello', style: {} }];
    const ctx = stubCtx();
    const layout = computeTableLayout(td, 'tbl', ctx, 200);
    // Available height smaller than padding + first line
    const splitH = findRowSplitHeight(layout, 0, 1);
    expect(splitH).toBe(0);
  });
});

describe('paginateLayout — row splitting', () => {
  function stubCtxWide(): CanvasRenderingContext2D {
    return {
      font: '',
      measureText: (text: string) => ({ width: text.length * 7 }),
    } as unknown as CanvasRenderingContext2D;
  }

  it('splits a tall single-row table across pages', () => {
    // DEFAULT_PAGE_SETUP: 1056px tall, 96px top/bottom margins → 864px content height
    const setup = DEFAULT_PAGE_SETUP;
    const { width, height: pageHeight } = getEffectiveDimensions(setup);
    const contentHeight = pageHeight - setup.margins.top - setup.margins.bottom;
    const contentWidth = width - setup.margins.left - setup.margins.right;

    // Build a 1×1 table whose single cell has enough paragraph blocks to
    // exceed one page's content height (each paragraph ~24px → need > 36 paragraphs)
    const tableBlock = createTableBlock(1, 1);
    const td = tableBlock.tableData!;
    const cell = td.rows[0].cells[0];

    // Add 40 paragraph blocks (each will produce ~24px lines at 7px/char width)
    cell.blocks = [];
    for (let i = 0; i < 40; i++) {
      cell.blocks.push({
        id: `p${i}`,
        type: 'paragraph',
        inlines: [{ text: `Paragraph line number ${i} with some text content`, style: {} }],
        style: { alignment: 'left', lineHeight: 1.5, marginTop: 0, marginBottom: 8, textIndent: 0, marginLeft: 0 },
      });
    }

    const ctx = stubCtxWide();
    const { layout } = computeLayout([tableBlock], ctx, contentWidth);
    const result = paginateLayout(layout, setup);

    // Should span at least 2 pages due to tall row
    expect(result.pages.length).toBeGreaterThanOrEqual(2);

    // First page must have at least one PageLine for the row with rowSplitOffset === 0
    const firstPageLines = result.pages[0].lines.filter(
      (pl) => pl.rowSplitOffset !== undefined,
    );
    expect(firstPageLines.length).toBeGreaterThan(0);
    const firstFragment = firstPageLines[0];
    expect(firstFragment.rowSplitOffset).toBe(0);
    expect(firstFragment.rowSplitHeight).toBeDefined();
    expect(firstFragment.rowSplitHeight).toBeGreaterThan(0);
    expect(firstFragment.rowSplitHeight).toBeLessThanOrEqual(contentHeight);

    // Second page must have a PageLine for the same row with rowSplitOffset > 0
    const secondPageLines = result.pages[1].lines.filter(
      (pl) => pl.rowSplitOffset !== undefined && pl.rowSplitOffset > 0,
    );
    expect(secondPageLines.length).toBeGreaterThan(0);
  });
});
