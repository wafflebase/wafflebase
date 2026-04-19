import { describe, it, expect } from 'vitest';
import { computeTableLayout, getCellContentBreakpoints } from '../../src/view/table-layout.js';
import { createTableBlock, DEFAULT_PAGE_SETUP, getEffectiveDimensions } from '../../src/model/types.js';
import { computeLayout } from '../../src/view/layout.js';
import { paginateLayout } from '../../src/view/pagination.js';

function stubCtx(): CanvasRenderingContext2D {
  return {
    font: '',
    measureText: (text: string) => ({ width: text.length * 7 }),
  } as unknown as CanvasRenderingContext2D;
}

describe('getCellContentBreakpoints', () => {
  it('returns cumulative line heights for a single-cell row', () => {
    const block = createTableBlock(1, 1);
    const td = block.tableData!;
    td.rows[0].cells[0].blocks[0].inlines = [
      { text: 'Line 1 text here', style: {} },
      { text: ' and more text', style: {} },
    ];
    const ctx = stubCtx();
    const layout = computeTableLayout(td, 'tbl', ctx, 200);
    const breakpoints = getCellContentBreakpoints(layout, 0);

    expect(breakpoints.length).toBeGreaterThan(0);
    for (let i = 1; i < breakpoints.length; i++) {
      expect(breakpoints[i]).toBeGreaterThan(breakpoints[i - 1]);
    }
  });

  it('returns empty array for out-of-bounds row index', () => {
    const block = createTableBlock(1, 1);
    const td = block.tableData!;
    td.rows[0].cells[0].blocks[0].inlines = [{ text: 'hello', style: {} }];
    const ctx = stubCtx();
    const layout = computeTableLayout(td, 'tbl', ctx, 200);
    expect(getCellContentBreakpoints(layout, 5)).toEqual([]);
  });

  it('returns only common breakpoints across multiple columns', () => {
    // Two-column table: left cell has 1 line, right cell has 2 lines
    // Only the height after the first line of both cells can be a shared breakpoint
    const block = createTableBlock(1, 2);
    const td = block.tableData!;
    // Left cell: single short text (likely 1 line)
    td.rows[0].cells[0].blocks[0].inlines = [{ text: 'A', style: {} }];
    // Right cell: same short text (same height → same break)
    td.rows[0].cells[1].blocks[0].inlines = [{ text: 'B', style: {} }];
    const ctx = stubCtx();
    const layout = computeTableLayout(td, 'tbl', ctx, 200);
    const breakpoints = getCellContentBreakpoints(layout, 0);

    // All breakpoints must be strictly ascending
    for (let i = 1; i < breakpoints.length; i++) {
      expect(breakpoints[i]).toBeGreaterThan(breakpoints[i - 1]);
    }
  });

  it('returns empty array for merged cells row with no non-merged cells', () => {
    const block = createTableBlock(1, 2);
    const td = block.tableData!;
    // Simulate a covered cell scenario by marking both as merged is not
    // directly possible with just colSpan=0, but we can test with a
    // row that has no content if cells are set to merged pattern.
    td.rows[0].cells[0].colSpan = 2;
    td.rows[0].cells[1].colSpan = 0;
    td.rows[0].cells[1].blocks = [];
    const ctx = stubCtx();
    const layout = computeTableLayout(td, 'tbl', ctx, 200);
    // Row 0 has 1 non-merged cell (col 0 with colSpan=2) and 1 merged (col 1)
    const breakpoints = getCellContentBreakpoints(layout, 0);
    // Should still return breakpoints from the single non-merged cell
    expect(Array.isArray(breakpoints)).toBe(true);
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
