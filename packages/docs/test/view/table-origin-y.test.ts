import { describe, it, expect } from 'vitest';
import { computeLayout } from '../../src/view/layout.js';
import {
  paginateLayout,
  getPageYOffset,
  getTableOriginYForPageLine,
} from '../../src/view/pagination.js';
import {
  createTableBlock,
  DEFAULT_PAGE_SETUP,
  getEffectiveDimensions,
  DEFAULT_BLOCK_STYLE,
} from '../../src/model/types.js';

function stubCtx(): CanvasRenderingContext2D {
  return {
    font: '',
    measureText: (text: string) => ({ width: text.length * 7 }),
  } as unknown as CanvasRenderingContext2D;
}

/**
 * Regression: when a table row splits across pages and the
 * continuation fragment lands as the first PageLine on the next page,
 * `getTableOriginYForPageLine` must return the SAME virtual table
 * origin for the split fragment and for any non-split follow-up row of
 * the same table on that page. Otherwise hit-testing for row resize
 * handles drifts away from where the renderer actually drew the rows.
 */
describe('getTableOriginYForPageLine', () => {
  it('agrees across split fragment and follow-up rows on the same page', () => {
    const setup = DEFAULT_PAGE_SETUP;
    const { width } = getEffectiveDimensions(setup);
    const contentWidth = width - setup.margins.left - setup.margins.right;

    // 3-row table: row 0 is tall (forces split across pages 1 and 2),
    // rows 1 and 2 are short and land on page 2 right after the
    // continuation fragment of row 0.
    const tableBlock = createTableBlock(3, 1);
    const td = tableBlock.tableData!;
    const r0Cell = td.rows[0].cells[0];
    r0Cell.blocks = [];
    for (let i = 0; i < 60; i++) {
      r0Cell.blocks.push({
        id: `r0p${i}`,
        type: 'paragraph',
        inlines: [{ text: `Row0 paragraph ${i} with text content`, style: {} }],
        style: { ...DEFAULT_BLOCK_STYLE },
      });
    }
    td.rows[1].cells[0].blocks[0].inlines = [{ text: 'Row 1', style: {} }];
    td.rows[2].cells[0].blocks[0].inlines = [{ text: 'Row 2', style: {} }];

    const ctx = stubCtx();
    const { layout } = computeLayout([tableBlock], ctx, contentWidth);
    const paginated = paginateLayout(layout, setup);

    // Locate the page that holds the continuation fragment.
    const pageIndex = paginated.pages.findIndex((p) =>
      p.lines.some((pl) => pl.rowSplitOffset !== undefined && pl.rowSplitOffset > 0),
    );
    expect(pageIndex).toBeGreaterThan(0);

    const page = paginated.pages[pageIndex];
    const pageY = getPageYOffset(paginated, pageIndex);
    const lb = layout.blocks[0];
    expect(lb.layoutTable).toBeDefined();
    const rowYOffsets = lb.layoutTable!.rowYOffsets;

    // The first PL on this page must be the row-0 continuation, with
    // a non-zero rowSplitOffset.
    const firstPl = page.lines[0];
    expect(firstPl.lineIndex).toBe(0);
    expect(firstPl.rowSplitOffset).toBeDefined();
    expect(firstPl.rowSplitOffset!).toBeGreaterThan(0);

    // Find a follow-up non-split PageLine for row 1 on the same page.
    const row1Pl = page.lines.find(
      (pl) => pl.lineIndex === 1 && pl.rowSplitOffset === undefined,
    );
    expect(row1Pl).toBeDefined();

    const originFromSplit = getTableOriginYForPageLine(pageY, firstPl, rowYOffsets);
    const originFromRow1 = getTableOriginYForPageLine(pageY, row1Pl!, rowYOffsets);

    // Same physical table → same virtual origin.
    expect(originFromSplit).toBe(originFromRow1);
  });

  it('matches the simple formula for a non-split first PageLine', () => {
    const setup = DEFAULT_PAGE_SETUP;
    const { width } = getEffectiveDimensions(setup);
    const contentWidth = width - setup.margins.left - setup.margins.right;

    const tableBlock = createTableBlock(2, 1);
    const td = tableBlock.tableData!;
    td.rows[0].cells[0].blocks[0].inlines = [{ text: 'A', style: {} }];
    td.rows[1].cells[0].blocks[0].inlines = [{ text: 'B', style: {} }];

    const ctx = stubCtx();
    const { layout } = computeLayout([tableBlock], ctx, contentWidth);
    const paginated = paginateLayout(layout, setup);

    const pageY = getPageYOffset(paginated, 0);
    const pl = paginated.pages[0].lines[0];
    const rowYOffsets = layout.blocks[0].layoutTable!.rowYOffsets;

    expect(getTableOriginYForPageLine(pageY, pl, rowYOffsets)).toBe(
      pageY + pl.y - rowYOffsets[pl.lineIndex],
    );
  });
});
