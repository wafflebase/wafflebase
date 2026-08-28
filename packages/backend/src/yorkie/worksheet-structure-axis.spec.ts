import { BadRequestException } from '@nestjs/common';
import { parseAxisMove, parseAxisShift } from './worksheet-structure';

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
});
