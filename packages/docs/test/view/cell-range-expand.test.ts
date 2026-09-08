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

import { Selection } from '../../src/view/selection.js';
import { computeLayout, type DocumentLayout, type LayoutBlock } from '../../src/view/layout.js';
import { createTableBlock, DEFAULT_PAGE_SETUP, getEffectiveDimensions } from '../../src/model/types.js';
import { stubMeasurer } from './_stub-measurer.js';

describe('Selection.getNormalizedRange — cell range expansion at read time', () => {
  it('expands a partially-overlapping cell range using layout TableData', () => {
    // Build a minimal fake DocumentLayout with one table block
    const t = makeTable(4, 4, {
      '1,1': mergedTopLeft(2, 2), '1,2': coveredCell(),
      '2,1': coveredCell(), '2,2': coveredCell(),
    });
    const tableBlock: any = {
      id: 't', type: 'table', inlines: [], style: {},
      tableData: t,
    };
    const lb: LayoutBlock = {
      block: tableBlock,
      lines: [],
      width: 0, height: 0, top: 0,
    } as unknown as LayoutBlock;
    const layout: DocumentLayout = {
      blocks: [lb],
      blockParentMap: new Map(),
    } as unknown as DocumentLayout;

    const sel = new Selection();
    sel.setRange({
      anchor: { blockId: 'anchor', offset: 0 },
      focus: { blockId: 'focus', offset: 0 },
      tableCellRange: rect(0, 0, 1, 1),
    });

    const normalized = sel.getNormalizedRange(layout);
    expect(normalized?.tableCellRange?.start).toEqual({ rowIndex: 0, colIndex: 0 });
    expect(normalized?.tableCellRange?.end).toEqual({ rowIndex: 2, colIndex: 2 });
  });

  /**
   * A nested table lives in `blockParentMap`, not in `layout.blocks`, so the
   * flat lookup this used to do found no `TableData` and the expansion above
   * silently did nothing — the columns a merge covers then painted only
   * inside the merged row (#1049).
   */
  it('expands inside a nested table too', () => {
    const outer = createTableBlock(1, 1);
    const inner = createTableBlock(3, 3);
    const itd = inner.tableData!;
    // Inner row 1 is one cell spanning columns 0–1.
    itd.rows[1].cells[0].colSpan = 2;
    itd.rows[1].cells[0].rowSpan = 1;
    itd.rows[1].cells[1].colSpan = 0;
    outer.tableData!.rows[0].cells[0].blocks = [inner];

    const setup = DEFAULT_PAGE_SETUP;
    const { width } = getEffectiveDimensions(setup);
    const { layout } = computeLayout(
      [outer],
      stubMeasurer(7),
      width - setup.margins.left - setup.margins.right,
    );

    const sel = new Selection();
    sel.setRange({
      anchor: { blockId: itd.rows[0].cells[0].blocks[0].id, offset: 0 },
      focus: { blockId: itd.rows[2].cells[0].blocks[0].id, offset: 0 },
      tableCellRange: {
        blockId: inner.id,
        start: { rowIndex: 0, colIndex: 0 },
        end: { rowIndex: 2, colIndex: 0 },
      },
    });

    const normalized = sel.getNormalizedRange(layout);
    expect(normalized?.tableCellRange?.start).toEqual({ rowIndex: 0, colIndex: 0 });
    expect(normalized?.tableCellRange?.end).toEqual({ rowIndex: 2, colIndex: 1 });
  });
});
