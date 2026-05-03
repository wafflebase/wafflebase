import { describe, it, expect } from 'vitest';
import { computeTableLayout, findRowSplitHeight } from '../../src/view/table-layout.js';
import { createTableBlock, DEFAULT_PAGE_SETUP, getEffectiveDimensions, DEFAULT_BLOCK_STYLE } from '../../src/model/types.js';
import { computeLayout } from '../../src/view/layout.js';
import { paginateLayout } from '../../src/view/pagination.js';
import { collectTableRenderRanges } from '../../src/view/doc-canvas.js';
import { stubMeasurer } from './_stub-measurer.js';

const stubCtx = () => stubMeasurer(7);

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
  const stubCtxWide = () => stubMeasurer(7);

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

describe('collectTableRenderRanges — split fragment + follow-up rows', () => {
  // Regression for the case where a split fragment lands as the first
  // PageLine on a page and is followed by additional non-split rows of
  // the same table block. Prior to the fix, the dedup logic skipped the
  // follow-up rows because they shared the same blockIndex as the split
  // fragment, leaving them invisible (no borders, no cell text).
  it('emits a separate range for non-split rows that follow a split fragment', () => {
    const setup = DEFAULT_PAGE_SETUP;
    const { width, height: pageHeight } = getEffectiveDimensions(setup);
    const contentWidth = width - setup.margins.left - setup.margins.right;
    const contentHeight = pageHeight - setup.margins.top - setup.margins.bottom;

    // Build a 1×1 table with three rows. Row 0 is tall enough to span
    // two pages; rows 1 and 2 are short and land on the second page
    // right after the split-fragment continuation of row 0.
    const tableBlock = createTableBlock(3, 1);
    const td = tableBlock.tableData!;

    // Row 0: many paragraphs to force a split. 60 ≈ 1.5 pages worth
    // of paragraphs at ~24px each on the default page setup (864px
    // content height), which forces row 0 across two pages with rows
    // 1+2 landing on the continuation page right after the split
    // fragment — the exact PageLine arrangement that triggers the bug.
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
    // Row 1 + row 2: single short paragraph each.
    td.rows[1].cells[0].blocks[0].inlines = [{ text: 'Row 1 marker', style: {} }];
    td.rows[2].cells[0].blocks[0].inlines = [{ text: 'Row 2 marker', style: {} }];

    const ctx = stubMeasurer(7);

    const { layout } = computeLayout([tableBlock], ctx, contentWidth);
    const paginated = paginateLayout(layout, setup);

    // Find the page where the split continuation lands. It is the first
    // page that has a PageLine with rowSplitOffset > 0.
    const continuationPageIndex = paginated.pages.findIndex((p) =>
      p.lines.some((pl) => pl.rowSplitOffset !== undefined && pl.rowSplitOffset > 0),
    );
    expect(continuationPageIndex).toBeGreaterThan(0);

    const contPage = paginated.pages[continuationPageIndex];

    // Sanity: that page should also contain rows 1 and 2 (they are
    // short enough to fit after the row-0 continuation fragment).
    const lineIndices = contPage.lines.map((pl) => pl.lineIndex);
    expect(lineIndices).toContain(0); // row 0 continuation
    expect(lineIndices).toContain(1);
    expect(lineIndices).toContain(2);

    // The first PL on that page must be the split fragment of row 0.
    expect(contPage.lines[0].lineIndex).toBe(0);
    expect(contPage.lines[0].rowSplitOffset).toBeGreaterThan(0);

    const ranges = collectTableRenderRanges(
      contPage,
      layout,
      0,
      contentHeight,
      setup.margins,
    );

    // Expect exactly two ranges for this single table block on this
    // page: one clipped split-fragment range (row 0) and one regular
    // range that covers rows 1..2. Asserting an exact count rejects
    // future regressions that produce extra (duplicate) ranges.
    const rangesForBlock = ranges.filter((r) => r.layoutBlock.block === tableBlock);
    expect(rangesForBlock.length).toBe(2);

    const splitRange = rangesForBlock.find((r) => r.rowSplitOffset !== undefined);
    expect(splitRange).toBeDefined();
    expect(splitRange!.pageStartRow).toBe(0);
    expect(splitRange!.endRowIndex).toBe(1);

    const followUp = rangesForBlock.find(
      (r) => r.rowSplitOffset === undefined && r.pageStartRow >= 1,
    );
    expect(followUp).toBeDefined();
    expect(followUp!.pageStartRow).toBe(1);
    // Sweep should cover row 2 as well.
    expect(followUp!.endRowIndex).toBe(3);
  });
});
