// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import '../../../src/view/canvas/test-canvas-env';
import type { TableElement } from '../../../src/model/element';
import { nextCellInDirection } from '../../../src/view/canvas/table-renderer';

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

describe('nextCellInDirection', () => {
  it('forward steps right within a row', () => {
    const d = simple2x3();
    expect(nextCellInDirection(d, 0, 0, 1)).toEqual({ row: 0, col: 1 });
    expect(nextCellInDirection(d, 0, 1, 1)).toEqual({ row: 0, col: 2 });
  });

  it('forward wraps to (r+1, 0) at the right edge', () => {
    const d = simple2x3();
    expect(nextCellInDirection(d, 0, 2, 1)).toEqual({ row: 1, col: 0 });
  });

  it('forward returns null past the last cell', () => {
    const d = simple2x3();
    expect(nextCellInDirection(d, 1, 2, 1)).toBeNull();
  });

  it('backward steps left within a row', () => {
    const d = simple2x3();
    expect(nextCellInDirection(d, 1, 1, -1)).toEqual({ row: 1, col: 0 });
  });

  it('backward wraps to (r-1, nCols-1) at the left edge', () => {
    const d = simple2x3();
    expect(nextCellInDirection(d, 1, 0, -1)).toEqual({ row: 0, col: 2 });
  });

  it('backward returns null before the first cell', () => {
    const d = simple2x3();
    expect(nextCellInDirection(d, 0, 0, -1)).toBeNull();
  });

  it('skips over hMerge-covered cells when stepping forward', () => {
    // Row 0: anchor at (0,0) gridSpan=2, (0,1) covered.
    const d = data({
      columnWidths: [100, 100, 100],
      rows: [
        {
          height: 50,
          cells: [
            { body: { blocks: [] }, style: {}, gridSpan: 2 },
            { body: { blocks: [] }, style: {}, gridSpan: 0 },
            { body: { blocks: [] }, style: {} },
          ],
        },
      ],
    });
    // From (0,0) forward jumps over (0,1) covered to (0,2).
    expect(nextCellInDirection(d, 0, 0, 1)).toEqual({ row: 0, col: 2 });
  });

  it('skips over vMerge-covered cells when wrapping forward across rows', () => {
    // Row 0 anchor at (0,0) rowSpan=2; row 1 col 0 covered.
    const d = data({
      columnWidths: [100, 100],
      rows: [
        {
          height: 50,
          cells: [
            { body: { blocks: [] }, style: {}, rowSpan: 2 },
            { body: { blocks: [] }, style: {} },
          ],
        },
        {
          height: 50,
          cells: [
            { body: { blocks: [] }, style: {}, rowSpan: 0 },
            { body: { blocks: [] }, style: {} },
          ],
        },
      ],
    });
    // From (0,1) forward wraps to row 1: (1,0) is covered → skip → (1,1).
    expect(nextCellInDirection(d, 0, 1, 1)).toEqual({ row: 1, col: 1 });
  });

  it('skips over 2D-merged covered cells in both directions', () => {
    // (0,0) anchor with gridSpan=2 rowSpan=2 covers (0,1), (1,0), (1,1).
    // Only non-covered cells: (0,0), (0,2), (1,2), and any row 2 cells.
    const d = data({
      columnWidths: [100, 100, 100],
      rows: [
        {
          height: 50,
          cells: [
            { body: { blocks: [] }, style: {}, gridSpan: 2, rowSpan: 2 },
            { body: { blocks: [] }, style: {}, gridSpan: 0 },
            { body: { blocks: [] }, style: {} },
          ],
        },
        {
          height: 50,
          cells: [
            { body: { blocks: [] }, style: {}, rowSpan: 0 },
            { body: { blocks: [] }, style: {}, gridSpan: 0, rowSpan: 0 },
            { body: { blocks: [] }, style: {} },
          ],
        },
      ],
    });
    // (0,0) forward → skip (0,1) covered → (0,2).
    expect(nextCellInDirection(d, 0, 0, 1)).toEqual({ row: 0, col: 2 });
    // (0,2) forward → wraps to row 1 → (1,0) covered → (1,1) covered → (1,2).
    expect(nextCellInDirection(d, 0, 2, 1)).toEqual({ row: 1, col: 2 });
    // (1,2) backward → walks back through covered (1,1), (1,0) and lands on
    // (0,2), the previous non-covered cell in scan order.
    expect(nextCellInDirection(d, 1, 2, -1)).toEqual({ row: 0, col: 2 });
    // Continuing backward from (0,2) → skip (0,1) covered → land on the
    // 2D-merge anchor at (0,0).
    expect(nextCellInDirection(d, 0, 2, -1)).toEqual({ row: 0, col: 0 });
  });
});
