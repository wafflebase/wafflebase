// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import '../../../src/view/canvas/test-canvas-env';
import type { TableElement } from '../../../src/model/element';
import {
  computeTableLayout,
  tableCellAtPoint,
} from '../../../src/view/canvas/table-renderer';

const data = (d: TableElement['data']) => d;

function simple2x3(): TableElement['data'] {
  return {
    columnWidths: [100, 100, 100],
    rows: [
      {
        height: 50,
        cells: [
          { body: { blocks: [] }, style: {} },
          { body: { blocks: [] }, style: {} },
          { body: { blocks: [] }, style: {} },
        ],
      },
      {
        height: 50,
        cells: [
          { body: { blocks: [] }, style: {} },
          { body: { blocks: [] }, style: {} },
          { body: { blocks: [] }, style: {} },
        ],
      },
    ],
  };
}

describe('tableCellAtPoint', () => {
  it('returns the cell at a point inside its rect', () => {
    const d = simple2x3();
    const layout = computeTableLayout(d);
    expect(tableCellAtPoint(d, layout, 50, 25)).toEqual({ row: 0, col: 0 });
    expect(tableCellAtPoint(d, layout, 150, 25)).toEqual({ row: 0, col: 1 });
    expect(tableCellAtPoint(d, layout, 250, 75)).toEqual({ row: 1, col: 2 });
  });

  it('returns null when the point is outside the table bounds', () => {
    const d = simple2x3();
    const layout = computeTableLayout(d);
    expect(tableCellAtPoint(d, layout, -1, 25)).toBeNull();
    expect(tableCellAtPoint(d, layout, 301, 25)).toBeNull();
    expect(tableCellAtPoint(d, layout, 50, -1)).toBeNull();
    expect(tableCellAtPoint(d, layout, 50, 101)).toBeNull();
  });

  it('snaps to the anchor when the hit lands on an hMerge-covered cell', () => {
    const d = data({
      columnWidths: [100, 100, 100],
      rows: [
        {
          height: 50,
          cells: [
            { body: { blocks: [] }, style: {}, gridSpan: 3 },
            { body: { blocks: [] }, style: {}, gridSpan: 0 },
            { body: { blocks: [] }, style: {}, gridSpan: 0 },
          ],
        },
      ],
    });
    const layout = computeTableLayout(d);
    expect(tableCellAtPoint(d, layout, 50, 25)).toEqual({ row: 0, col: 0 });
    expect(tableCellAtPoint(d, layout, 150, 25)).toEqual({ row: 0, col: 0 });
    expect(tableCellAtPoint(d, layout, 250, 25)).toEqual({ row: 0, col: 0 });
  });

  it('snaps to the anchor when the hit lands on a vMerge-covered cell', () => {
    const d = data({
      columnWidths: [100],
      rows: [
        {
          height: 50,
          cells: [{ body: { blocks: [] }, style: {}, rowSpan: 3 }],
        },
        {
          height: 50,
          cells: [{ body: { blocks: [] }, style: {}, rowSpan: 0 }],
        },
        {
          height: 50,
          cells: [{ body: { blocks: [] }, style: {}, rowSpan: 0 }],
        },
      ],
    });
    const layout = computeTableLayout(d);
    expect(tableCellAtPoint(d, layout, 50, 25)).toEqual({ row: 0, col: 0 });
    expect(tableCellAtPoint(d, layout, 50, 75)).toEqual({ row: 0, col: 0 });
    expect(tableCellAtPoint(d, layout, 50, 125)).toEqual({ row: 0, col: 0 });
  });

  it('snaps to the anchor when the hit lands in a 2D-merged region (both hMerge and vMerge)', () => {
    const d = data({
      columnWidths: [100, 100],
      rows: [
        {
          height: 50,
          cells: [
            {
              body: { blocks: [] },
              style: {},
              gridSpan: 2,
              rowSpan: 2,
            },
            { body: { blocks: [] }, style: {}, gridSpan: 0 },
          ],
        },
        {
          height: 50,
          cells: [
            { body: { blocks: [] }, style: {}, rowSpan: 0 },
            {
              body: { blocks: [] },
              style: {},
              gridSpan: 0,
              rowSpan: 0,
            },
          ],
        },
      ],
    });
    const layout = computeTableLayout(d);
    // Anchor itself
    expect(tableCellAtPoint(d, layout, 50, 25)).toEqual({ row: 0, col: 0 });
    // hMerge-covered (top right)
    expect(tableCellAtPoint(d, layout, 150, 25)).toEqual({ row: 0, col: 0 });
    // vMerge-covered (bottom left)
    expect(tableCellAtPoint(d, layout, 50, 75)).toEqual({ row: 0, col: 0 });
    // 2D-covered (bottom right)
    expect(tableCellAtPoint(d, layout, 150, 75)).toEqual({ row: 0, col: 0 });
  });

  it('treats the bottom-right table corner as the last cell, not out of bounds', () => {
    const d = simple2x3();
    const layout = computeTableLayout(d);
    // Just inside the last cell's bottom-right
    expect(tableCellAtPoint(d, layout, 299, 99)).toEqual({ row: 1, col: 2 });
  });
});
