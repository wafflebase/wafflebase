// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { DEFAULT_BLOCK_STYLE } from '@wafflebase/docs';
import '../../../src/view/canvas/test-canvas-env';
import type { TableElement } from '../../../src/model/element';
import { computeTableLayout } from '../../../src/view/canvas/table-renderer';

const data = (d: TableElement['data']) => d;

describe('computeTableLayout', () => {
  it('builds colX as a prefix sum of columnWidths', () => {
    const { colX } = computeTableLayout(
      data({
        columnWidths: [10, 30, 60],
        rows: [
          {
            height: 10,
            cells: [
              { body: { blocks: [] }, style: {} },
              { body: { blocks: [] }, style: {} },
              { body: { blocks: [] }, style: {} },
            ],
          },
        ],
      }),
    );
    expect(Array.from(colX)).toEqual([0, 10, 40, 100]);
  });

  it('preserves declared row heights when no cell content exceeds them', () => {
    const { rowY, rowH } = computeTableLayout(
      data({
        columnWidths: [100],
        rows: [
          { height: 50, cells: [{ body: { blocks: [] }, style: {} }] },
          { height: 70, cells: [{ body: { blocks: [] }, style: {} }] },
        ],
      }),
    );
    expect(Array.from(rowH)).toEqual([50, 70]);
    expect(Array.from(rowY)).toEqual([0, 50, 120]);
  });

  it('grows a row to fit a tall rowSpan=1 cell', () => {
    // Tiny declared height (4 px) forces auto-grow.
    const { rowH } = computeTableLayout(
      data({
        columnWidths: [100],
        rows: [
          {
            height: 4,
            cells: [
              {
                body: {
                  blocks: [
                    {
                      id: 'b',
                      type: 'paragraph',
                      inlines: [{ text: 'tall', style: { fontSize: 24 } }],
                      style: { ...DEFAULT_BLOCK_STYLE },
                    },
                  ],
                },
                style: {},
              },
            ],
          },
        ],
      }),
    );
    expect(rowH[0]).toBeGreaterThan(4);
  });

  it('grows the LAST row of a merge span when a rowSpan>1 anchor overflows', () => {
    // Two-row table, anchor at (0,0) rowSpan=2 with content that
    // needs more than the declared 10+10=20 px.
    const { rowH } = computeTableLayout(
      data({
        columnWidths: [100],
        rows: [
          {
            height: 10,
            cells: [
              {
                body: {
                  blocks: [
                    {
                      id: 'b',
                      type: 'paragraph',
                      inlines: [{ text: 'tall', style: { fontSize: 24 } }],
                      style: { ...DEFAULT_BLOCK_STYLE },
                    },
                  ],
                },
                style: {},
                rowSpan: 2,
              },
            ],
          },
          {
            height: 10,
            cells: [
              { body: { blocks: [] }, style: {}, rowSpan: 0 },
            ],
          },
        ],
      }),
    );
    // Row 0 stays at its declared 10 px; row 1 absorbs the deficit.
    expect(rowH[0]).toBe(10);
    expect(rowH[1]).toBeGreaterThan(10);
    expect(rowH[0] + rowH[1]).toBeGreaterThan(20);
  });

  it('returns colX / rowY / rowH arrays whose lengths match the grid', () => {
    const { colX, rowY, rowH } = computeTableLayout(
      data({
        columnWidths: [10, 20, 30],
        rows: [
          {
            height: 5,
            cells: [
              { body: { blocks: [] }, style: {} },
              { body: { blocks: [] }, style: {} },
              { body: { blocks: [] }, style: {} },
            ],
          },
          {
            height: 10,
            cells: [
              { body: { blocks: [] }, style: {} },
              { body: { blocks: [] }, style: {} },
              { body: { blocks: [] }, style: {} },
            ],
          },
        ],
      }),
    );
    expect(colX.length).toBe(4); // nCols + 1
    expect(rowY.length).toBe(3); // nRows + 1
    expect(rowH.length).toBe(2);
  });

  it('returns empty arrays for a table with zero rows / columns', () => {
    const empty = { columnWidths: [], rows: [] };
    const layout = computeTableLayout(empty);
    expect(Array.from(layout.colX)).toEqual([0]);
    expect(Array.from(layout.rowY)).toEqual([0]);
    expect(Array.from(layout.rowH)).toEqual([]);
  });
});
