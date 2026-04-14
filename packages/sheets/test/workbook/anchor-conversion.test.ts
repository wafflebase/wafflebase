import { describe, it, expect } from 'vitest';
import {
  anchorToRef,
  refToAnchor,
  rangeAnchorToRange,
  rangeToRangeAnchor,
} from '../../src/model/workbook/anchor-conversion';
import type {
  CellAnchor,
  RangeAnchor,
} from '../../src/model/workbook/anchor-conversion';
import type { Range } from '../../src/model/core/types';

const rowOrder = ['r1', 'r2', 'r3', 'r4', 'r5'];
const colOrder = ['c1', 'c2', 'c3', 'c4'];

describe('anchorToRef', () => {
  it('converts axis IDs to visual position', () => {
    const anchor: CellAnchor = { rowId: 'r2', colId: 'c3' };
    expect(anchorToRef(anchor, rowOrder, colOrder)).toEqual({ r: 2, c: 3 });
  });

  it('returns null when rowId is deleted', () => {
    const anchor: CellAnchor = { rowId: 'deleted', colId: 'c1' };
    expect(anchorToRef(anchor, rowOrder, colOrder)).toBeNull();
  });

  it('returns null when colId is deleted', () => {
    const anchor: CellAnchor = { rowId: 'r1', colId: 'deleted' };
    expect(anchorToRef(anchor, rowOrder, colOrder)).toBeNull();
  });

  it('reflects position change after row insertion', () => {
    const anchor: CellAnchor = { rowId: 'r3', colId: 'c2' };
    // Before insertion: r3 is at index 2 → r=3
    expect(anchorToRef(anchor, rowOrder, colOrder)).toEqual({ r: 3, c: 2 });

    // After inserting a row before r3
    const newRowOrder = ['r1', 'r2', 'rNew', 'r3', 'r4', 'r5'];
    expect(anchorToRef(anchor, newRowOrder, colOrder)).toEqual({ r: 4, c: 2 });
  });
});

describe('refToAnchor', () => {
  it('converts visual position to axis IDs', () => {
    expect(refToAnchor({ r: 1, c: 1 }, rowOrder, colOrder)).toEqual({
      rowId: 'r1',
      colId: 'c1',
    });
    expect(refToAnchor({ r: 5, c: 4 }, rowOrder, colOrder)).toEqual({
      rowId: 'r5',
      colId: 'c4',
    });
  });

  it('returns null for out-of-bounds row', () => {
    expect(refToAnchor({ r: 6, c: 1 }, rowOrder, colOrder)).toBeNull();
  });

  it('returns null for out-of-bounds column', () => {
    expect(refToAnchor({ r: 1, c: 5 }, rowOrder, colOrder)).toBeNull();
  });

  it('returns null for zero index', () => {
    expect(refToAnchor({ r: 0, c: 1 }, rowOrder, colOrder)).toBeNull();
  });
});

describe('rangeAnchorToRange', () => {
  it('converts a normal range', () => {
    const anchor: RangeAnchor = {
      startRowId: 'r2',
      startColId: 'c1',
      endRowId: 'r4',
      endColId: 'c3',
    };
    expect(rangeAnchorToRange(anchor, rowOrder, colOrder)).toEqual([
      { r: 2, c: 1 },
      { r: 4, c: 3 },
    ]);
  });

  it('handles entire-row selection (null colIds)', () => {
    const anchor: RangeAnchor = {
      startRowId: 'r2',
      startColId: null,
      endRowId: 'r4',
      endColId: null,
    };
    expect(rangeAnchorToRange(anchor, rowOrder, colOrder)).toEqual([
      { r: 2, c: 1 },
      { r: 4, c: 4 },
    ]);
  });

  it('handles entire-column selection (null rowIds)', () => {
    const anchor: RangeAnchor = {
      startRowId: null,
      startColId: 'c2',
      endRowId: null,
      endColId: 'c3',
    };
    expect(rangeAnchorToRange(anchor, rowOrder, colOrder)).toEqual([
      { r: 1, c: 2 },
      { r: 5, c: 3 },
    ]);
  });

  it('handles select-all (all null)', () => {
    const anchor: RangeAnchor = {
      startRowId: null,
      startColId: null,
      endRowId: null,
      endColId: null,
    };
    expect(rangeAnchorToRange(anchor, rowOrder, colOrder)).toEqual([
      { r: 1, c: 1 },
      { r: 5, c: 4 },
    ]);
  });

  it('returns null when both row endpoints are deleted', () => {
    const anchor: RangeAnchor = {
      startRowId: 'deleted1',
      startColId: 'c1',
      endRowId: 'deleted2',
      endColId: 'c3',
    };
    expect(rangeAnchorToRange(anchor, rowOrder, colOrder)).toBeNull();
  });

  it('returns null when both col endpoints are deleted', () => {
    const anchor: RangeAnchor = {
      startRowId: 'r1',
      startColId: 'deleted1',
      endRowId: 'r3',
      endColId: 'deleted2',
    };
    expect(rangeAnchorToRange(anchor, rowOrder, colOrder)).toBeNull();
  });

  it('uses visual dimension for null fields when provided', () => {
    const dimension = { rows: 100, columns: 26 };
    const anchor: RangeAnchor = {
      startRowId: 'r2',
      startColId: null,
      endRowId: 'r3',
      endColId: null,
    };
    expect(rangeAnchorToRange(anchor, rowOrder, colOrder, dimension)).toEqual([
      { r: 2, c: 1 },
      { r: 3, c: 26 },
    ]);
  });

  it('uses visual dimension for select-all when provided', () => {
    const dimension = { rows: 100, columns: 26 };
    const anchor: RangeAnchor = {
      startRowId: null,
      startColId: null,
      endRowId: null,
      endColId: null,
    };
    expect(rangeAnchorToRange(anchor, rowOrder, colOrder, dimension)).toEqual([
      { r: 1, c: 1 },
      { r: 100, c: 26 },
    ]);
  });
});

describe('rangeToRangeAnchor', () => {
  it('converts a normal cell range', () => {
    const range: Range = [{ r: 2, c: 1 }, { r: 4, c: 3 }];
    const result = rangeToRangeAnchor(range, rowOrder, colOrder, 'cell');
    expect(result).toEqual({
      startRowId: 'r2',
      startColId: 'c1',
      endRowId: 'r4',
      endColId: 'c3',
    });
  });

  it('stores null colIds for row selection type', () => {
    const range: Range = [{ r: 2, c: 1 }, { r: 4, c: 4 }];
    const result = rangeToRangeAnchor(range, rowOrder, colOrder, 'row');
    expect(result).toEqual({
      startRowId: 'r2',
      startColId: null,
      endRowId: 'r4',
      endColId: null,
    });
  });

  it('stores null rowIds for column selection type', () => {
    const range: Range = [{ r: 1, c: 2 }, { r: 5, c: 3 }];
    const result = rangeToRangeAnchor(range, rowOrder, colOrder, 'column');
    expect(result).toEqual({
      startRowId: null,
      startColId: 'c2',
      endRowId: null,
      endColId: 'c3',
    });
  });

  it('stores all null for select-all type', () => {
    const range: Range = [{ r: 1, c: 1 }, { r: 5, c: 4 }];
    const result = rangeToRangeAnchor(range, rowOrder, colOrder, 'all');
    expect(result).toEqual({
      startRowId: null,
      startColId: null,
      endRowId: null,
      endColId: null,
    });
  });
});
