import { describe, it, expect } from 'vitest';
import { parseRef, parseRefRange, toRefs } from '../../src/sheet/coordinates';

describe('parseRef', () => {
  it('should parse the cell reference and return the cell index', () => {
    expect(parseRef('A1')).toEqual({ row: 1, col: 1 });
    expect(parseRef('Z100')).toEqual({ row: 100, col: 26 });
    expect(parseRef('AB1')).toEqual({ row: 1, col: 28 });
  });

  it('should throw an error for invalid cell reference', () => {
    expect(() => parseRef('A')).toThrowError('Invalid Reference');
    expect(() => parseRef('@')).toThrowError('Invalid Reference');
    expect(() => parseRef('1A')).toThrowError('Invalid Reference');
  });
});

describe('parseRefRange', () => {
  it('should parse the range reference and return the cell indices', () => {
    expect(parseRefRange('A1:B3')).toEqual([
      { row: 1, col: 1 },
      { row: 3, col: 2 },
    ]);

    expect(parseRefRange('A1:A1')).toEqual([
      { row: 1, col: 1 },
      { row: 1, col: 1 },
    ]);
  });
});

describe('toRefs', () => {
  it('should convert the set of references to a generator of Ref', () => {
    const references = new Set(['A1', 'B2', 'C3']);
    const refs = toRefs(references);
    expect(refs.next().value).toEqual('A1');
    expect(refs.next().value).toEqual('B2');
    expect(refs.next().value).toEqual('C3');
  });

  it('should convert the set of range references to a generator of Ref', () => {
    const references = new Set(['A1:B2']);
    const refs = toRefs(references);
    expect(refs.next().value).toEqual('A1');
    expect(refs.next().value).toEqual('B1');
    expect(refs.next().value).toEqual('A2');
    expect(refs.next().value).toEqual('B2');
  });
});
