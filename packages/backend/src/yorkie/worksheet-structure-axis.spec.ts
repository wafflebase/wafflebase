import { BadRequestException } from '@nestjs/common';
import {
  MaxAxisEntries,
  assertAxisGrowth,
  parseAxisMove,
  parseAxisShift,
} from './worksheet-structure';

const MaxRows = 1000000;
const MaxColumns = 18278;

describe('parseAxisShift', () => {
  it('accepts a row and a column request', () => {
    expect(parseAxisShift({ axis: 'row', index: 3, count: 2 })).toEqual({
      axis: 'row',
      index: 3,
      count: 2,
    });
    expect(parseAxisShift({ axis: 'column', index: 1, count: 1 })).toEqual({
      axis: 'column',
      index: 1,
      count: 1,
    });
  });

  it('rejects a bad body or axis', () => {
    expect(() => parseAxisShift(null)).toThrow(BadRequestException);
    expect(() => parseAxisShift([])).toThrow(BadRequestException);
    expect(() =>
      parseAxisShift({ axis: 'diagonal', index: 1, count: 1 }),
    ).toThrow(BadRequestException);
  });

  it('rejects a non-positive, fractional or missing index/count', () => {
    for (const body of [
      { axis: 'row', index: 0, count: 1 },
      { axis: 'row', index: 1.5, count: 1 },
      { axis: 'row', index: 1, count: 0 },
      { axis: 'row', index: 1 },
      { axis: 'row', count: 1 },
    ]) {
      expect(() => parseAxisShift(body)).toThrow(BadRequestException);
    }
  });

  it('bounds the index by the axis, not by one shared limit', () => {
    // 18278 columns but 1e6 rows: a row index past the column bound is fine.
    expect(parseAxisShift({ axis: 'row', index: 20000, count: 1 }).index).toBe(
      20000,
    );
    expect(() =>
      parseAxisShift({ axis: 'column', index: 20000, count: 1 }),
    ).toThrow(BadRequestException);
  });

  it('bounds the index at the very top of each axis', () => {
    expect(
      parseAxisShift({ axis: 'row', index: MaxRows, count: 1 }).index,
    ).toBe(MaxRows);
    expect(() =>
      parseAxisShift({ axis: 'row', index: MaxRows + 1, count: 1 }),
    ).toThrow(BadRequestException);
    expect(
      parseAxisShift({ axis: 'column', index: MaxColumns, count: 1 }).index,
    ).toBe(MaxColumns);
    expect(() =>
      parseAxisShift({ axis: 'column', index: MaxColumns + 1, count: 1 }),
    ).toThrow(BadRequestException);
  });

  it('bounds count by the axis too', () => {
    expect(
      parseAxisShift({ axis: 'row', index: 1, count: MaxRows }).count,
    ).toBe(MaxRows);
    expect(() =>
      parseAxisShift({ axis: 'row', index: 1, count: MaxRows + 1 }),
    ).toThrow(BadRequestException);
    expect(() =>
      parseAxisShift({ axis: 'column', index: 1, count: MaxColumns + 1 }),
    ).toThrow(BadRequestException);
  });

  it('rejects a span that reaches past the axis', () => {
    // Each field is inside the axis on its own; together they name row
    // 1,000,001, which the engine's grid cannot address.
    expect(() =>
      parseAxisShift({ axis: 'row', index: MaxRows, count: 2 }),
    ).toThrow(BadRequestException);
    expect(() =>
      parseAxisShift({ axis: 'column', index: MaxColumns, count: 2 }),
    ).toThrow(BadRequestException);
  });

  it('accepts a span ending exactly on the last index', () => {
    expect(
      parseAxisShift({ axis: 'row', index: MaxRows - 1, count: 2 }),
    ).toEqual({ axis: 'row', index: MaxRows - 1, count: 2 });
  });

  it('still allows deleting the whole axis', () => {
    // The span check must not turn "delete every row" into a 400 — a delete
    // materializes nothing, so no work bound applies to it.
    expect(parseAxisShift({ axis: 'row', index: 1, count: MaxRows })).toEqual({
      axis: 'row',
      index: 1,
      count: MaxRows,
    });
  });

  it('rejects a non-finite index or count', () => {
    for (const body of [
      { axis: 'row', index: Number.NaN, count: 1 },
      { axis: 'row', index: 1, count: Number.POSITIVE_INFINITY },
      { axis: 'row', index: Number.MAX_SAFE_INTEGER, count: 1 },
    ]) {
      expect(() => parseAxisShift(body)).toThrow(BadRequestException);
    }
  });
});

describe('assertAxisGrowth', () => {
  it('accepts growth up to the cap', () => {
    expect(() => assertAxisGrowth('row', 0, MaxAxisEntries)).not.toThrow();
  });

  it('rejects growth past the cap', () => {
    expect(() => assertAxisGrowth('row', 0, MaxAxisEntries + 1)).toThrow(
      BadRequestException,
    );
  });

  it('measures growth against what already exists, not against zero', () => {
    // Otherwise a large real sheet could never be extended at all.
    expect(() =>
      assertAxisGrowth('row', 50000, 50000 + MaxAxisEntries),
    ).not.toThrow();
    expect(() =>
      assertAxisGrowth('row', 50000, 50000 + MaxAxisEntries + 1),
    ).toThrow(BadRequestException);
  });

  it('rejects a required length past the grid even when growth is small', () => {
    // The cumulative bound: each request is legal in isolation, and without
    // this one they walk the axis past the grid a page at a time.
    expect(() =>
      assertAxisGrowth('column', MaxColumns, MaxColumns + 1),
    ).toThrow(BadRequestException);
  });

  it('accepts a request that needs no growth', () => {
    expect(() => assertAxisGrowth('row', 1000, 1000)).not.toThrow();
  });
});

describe('parseAxisMove', () => {
  it('accepts a move in either direction', () => {
    expect(
      parseAxisMove({ axis: 'row', srcIndex: 5, count: 2, dstIndex: 1 }),
    ).toEqual({ axis: 'row', srcIndex: 5, count: 2, dstIndex: 1 });
    expect(
      parseAxisMove({ axis: 'column', srcIndex: 1, count: 1, dstIndex: 4 }),
    ).toEqual({ axis: 'column', srcIndex: 1, count: 1, dstIndex: 4 });
  });

  it('rejects a destination inside the moved block', () => {
    // Moving rows 2..4 to before row 3 would be a move into itself.
    expect(() =>
      parseAxisMove({ axis: 'row', srcIndex: 2, count: 3, dstIndex: 3 }),
    ).toThrow(BadRequestException);
    expect(() =>
      parseAxisMove({ axis: 'row', srcIndex: 2, count: 3, dstIndex: 4 }),
    ).toThrow(BadRequestException);
  });

  it('allows the boundaries just outside the block', () => {
    expect(
      parseAxisMove({ axis: 'row', srcIndex: 2, count: 3, dstIndex: 2 })
        .dstIndex,
    ).toBe(2);
    expect(
      parseAxisMove({ axis: 'row', srcIndex: 2, count: 3, dstIndex: 5 })
        .dstIndex,
    ).toBe(5);
  });

  it('rejects a missing field', () => {
    expect(() => parseAxisMove({ axis: 'row', srcIndex: 1, count: 1 })).toThrow(
      BadRequestException,
    );
  });

  it('bounds srcIndex, dstIndex and count by the axis', () => {
    expect(() =>
      parseAxisMove({
        axis: 'column',
        srcIndex: MaxColumns + 1,
        count: 1,
        dstIndex: 1,
      }),
    ).toThrow(BadRequestException);
    expect(() =>
      parseAxisMove({
        axis: 'column',
        srcIndex: 1,
        count: 1,
        dstIndex: MaxColumns + 1,
      }),
    ).toThrow(BadRequestException);
    expect(() =>
      parseAxisMove({
        axis: 'row',
        srcIndex: 1,
        count: MaxRows + 1,
        dstIndex: 3,
      }),
    ).toThrow(BadRequestException);
  });

  it('rejects a source block that reaches past the axis', () => {
    expect(() =>
      parseAxisMove({ axis: 'row', srcIndex: MaxRows, count: 2, dstIndex: 1 }),
    ).toThrow(BadRequestException);
  });

  it('bounds the moved block by MaxAxisEntries', () => {
    // The growth bound cannot cover this: a move on an axis that already
    // covers the block grows it by nothing, so growth is 0 for any `count`.
    // But `moveWorksheetAxis` splices the block out and spreads it back in,
    // so its cost is `count` regardless, and a large enough spread throws
    // `RangeError: Maximum call stack size exceeded`.
    expect(
      parseAxisMove({
        axis: 'row',
        srcIndex: 1,
        count: MaxAxisEntries,
        dstIndex: MaxAxisEntries + 1,
      }).count,
    ).toBe(MaxAxisEntries);
    expect(() =>
      parseAxisMove({
        axis: 'row',
        srcIndex: 1,
        count: MaxAxisEntries + 1,
        dstIndex: MaxAxisEntries + 2,
      }),
    ).toThrow(BadRequestException);
  });

  it('allows a source block ending on the last index', () => {
    expect(
      parseAxisMove({
        axis: 'row',
        srcIndex: MaxRows - 1,
        count: 2,
        dstIndex: 1,
      }).srcIndex,
    ).toBe(MaxRows - 1);
  });
});
