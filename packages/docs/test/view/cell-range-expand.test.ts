import { describe, it, expect } from 'vitest';
import {
  expandCellRangeForMerges,
  findMergeTopLeft,
} from '../../src/view/selection.js';
import type { TableCell, TableData, TableCellRange } from '../../src/model/types.js';

function plainCell(): TableCell {
  return {
    blocks: [{ id: 'b', type: 'paragraph', inlines: [{ text: '', style: {} }], style: {} as any }],
    style: {},
  };
}

function coveredCell(): TableCell {
  return { ...plainCell(), colSpan: 0 };
}

function mergedTopLeft(rowSpan: number, colSpan: number): TableCell {
  return { ...plainCell(), rowSpan, colSpan };
}

function makeTable(rows: number, cols: number, overrides: Record<string, TableCell> = {}): TableData {
  const data: TableData = { rows: [], columnWidths: Array(cols).fill(1 / cols) };
  for (let r = 0; r < rows; r++) {
    const cells: TableCell[] = [];
    for (let c = 0; c < cols; c++) {
      cells.push(overrides[`${r},${c}`] ?? plainCell());
    }
    data.rows.push({ cells });
  }
  return data;
}

function rect(r1: number, c1: number, r2: number, c2: number): TableCellRange {
  return { blockId: 't', start: { rowIndex: r1, colIndex: c1 }, end: { rowIndex: r2, colIndex: c2 } };
}

describe('findMergeTopLeft', () => {
  it('returns the cell itself when it is a plain cell', () => {
    const t = makeTable(3, 3);
    expect(findMergeTopLeft(t, 1, 1)).toEqual({ rowIndex: 1, colIndex: 1 });
  });

  it('returns the cell itself when it is a merge top-left', () => {
    const t = makeTable(3, 3, { '0,0': mergedTopLeft(2, 2), '0,1': coveredCell(), '1,0': coveredCell(), '1,1': coveredCell() });
    expect(findMergeTopLeft(t, 0, 0)).toEqual({ rowIndex: 0, colIndex: 0 });
  });

  it('walks back from a covered cell to its top-left', () => {
    const t = makeTable(3, 3, { '0,0': mergedTopLeft(2, 2), '0,1': coveredCell(), '1,0': coveredCell(), '1,1': coveredCell() });
    expect(findMergeTopLeft(t, 1, 1)).toEqual({ rowIndex: 0, colIndex: 0 });
    expect(findMergeTopLeft(t, 0, 1)).toEqual({ rowIndex: 0, colIndex: 0 });
    expect(findMergeTopLeft(t, 1, 0)).toEqual({ rowIndex: 0, colIndex: 0 });
  });
});

describe('expandCellRangeForMerges', () => {
  it('returns input rect unchanged when no merges touched', () => {
    const t = makeTable(3, 3);
    const r = rect(0, 0, 1, 1);
    expect(expandCellRangeForMerges(r, t)).toEqual(r);
  });

  it('expands when range partially overlaps a merge top-left', () => {
    // (1,1) is a 2x2 merged top-left covering (1,1)..(2,2)
    const t = makeTable(4, 4, {
      '1,1': mergedTopLeft(2, 2), '1,2': coveredCell(), '2,1': coveredCell(), '2,2': coveredCell(),
    });
    // User selects (0,0)..(1,1) — overlaps merge top-left
    const result = expandCellRangeForMerges(rect(0, 0, 1, 1), t);
    expect(result.start).toEqual({ rowIndex: 0, colIndex: 0 });
    expect(result.end).toEqual({ rowIndex: 2, colIndex: 2 });
  });

  it('walks back from a covered cell to include its top-left', () => {
    const t = makeTable(4, 4, {
      '1,1': mergedTopLeft(2, 2), '1,2': coveredCell(), '2,1': coveredCell(), '2,2': coveredCell(),
    });
    // User selects (2,2)..(3,3) — starts on a covered cell
    const result = expandCellRangeForMerges(rect(2, 2, 3, 3), t);
    expect(result.start).toEqual({ rowIndex: 1, colIndex: 1 });
    expect(result.end).toEqual({ rowIndex: 3, colIndex: 3 });
  });

  it('chains expansion across multiple merges (fixed-point)', () => {
    const t = makeTable(5, 5, {
      // Merge A: (0,2)..(1,3)
      '0,2': mergedTopLeft(2, 2), '0,3': coveredCell(),
      '1,2': coveredCell(), '1,3': coveredCell(),
      // Merge B: (1,0)..(2,1)
      '1,0': mergedTopLeft(2, 2), '1,1': coveredCell(),
      '2,0': coveredCell(), '2,1': coveredCell(),
    });
    // User picks (0,0)..(0,2): touches Merge A's top-left → expands to (0,0)..(1,3),
    // which now contains Merge B's top-left → expands to (0,0)..(2,3).
    const result = expandCellRangeForMerges(rect(0, 0, 0, 2), t);
    expect(result.start).toEqual({ rowIndex: 0, colIndex: 0 });
    expect(result.end).toEqual({ rowIndex: 2, colIndex: 3 });
  });

  it('handles a range whose start is greater than end (caller has not ordered)', () => {
    const t = makeTable(3, 3);
    const r = rect(2, 2, 0, 0);
    const result = expandCellRangeForMerges(r, t);
    expect(result.start).toEqual({ rowIndex: 0, colIndex: 0 });
    expect(result.end).toEqual({ rowIndex: 2, colIndex: 2 });
  });

  it('preserves blockId', () => {
    const t = makeTable(2, 2);
    const r: TableCellRange = { blockId: 'my-table', start: { rowIndex: 0, colIndex: 0 }, end: { rowIndex: 1, colIndex: 1 } };
    expect(expandCellRangeForMerges(r, t).blockId).toBe('my-table');
  });
});
