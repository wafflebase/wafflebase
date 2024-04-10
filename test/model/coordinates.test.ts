import { describe, it, expect } from 'vitest';
import {
  parseCellReference,
  parseRangeReference,
} from '../../src/model/coordinates';

describe('parseCellReference', () => {
  it('should parse the cell reference and return the cell index', () => {
    expect(parseCellReference('A1')).toEqual({ row: 1, col: 1 });
    expect(parseCellReference('Z100')).toEqual({ row: 100, col: 26 });
    expect(parseCellReference('AB1')).toEqual({ row: 1, col: 28 });
  });

  it('should throw an error for invalid cell reference', () => {
    expect(() => parseCellReference('A')).toThrowError('Invalid Reference');
    expect(() => parseCellReference('@')).toThrowError('Invalid Reference');
    expect(() => parseCellReference('1A')).toThrowError('Invalid Reference');
  });
});

describe('parseRangeReference', () => {
  it('should parse the range reference and return the cell indices', () => {
    expect(parseRangeReference('A1:B3')).toEqual([
      { row: 1, col: 1 },
      { row: 3, col: 2 },
    ]);

    expect(parseRangeReference('A1:A1')).toEqual([
      { row: 1, col: 1 },
      { row: 1, col: 1 },
    ]);
  });
});
