import { describe, it, expect } from 'vitest';
import {
  parseRef,
  parseRange,
  toSrefs,
  toBorderRanges,
} from '../../src/worksheet/coordinates';
import { Range } from '../../src/worksheet/types';

describe('parseRef', () => {
  it('should parse the Sref and return the Ref', () => {
    expect(parseRef('A1')).toEqual({ r: 1, c: 1 });
    expect(parseRef('Z100')).toEqual({ r: 100, c: 26 });
    expect(parseRef('AB1')).toEqual({ r: 1, c: 28 });
  });

  it('should throw an error for invalid Sref', () => {
    expect(() => parseRef('A')).toThrowError('Invalid Reference');
    expect(() => parseRef('@')).toThrowError('Invalid Reference');
    expect(() => parseRef('1A')).toThrowError('Invalid Reference');
  });
});

describe('parseRange', () => {
  it('should parse the Srng and return the Range', () => {
    expect(parseRange('A1:B3')).toEqual([
      { r: 1, c: 1 },
      { r: 3, c: 2 },
    ]);

    expect(parseRange('A1:A1')).toEqual([
      { r: 1, c: 1 },
      { r: 1, c: 1 },
    ]);
  });
});

describe('toSrefs', () => {
  it('should convert the set of Srefs to a generator of Ref', () => {
    const references = new Set(['A1', 'B2', 'C3']);
    const srefs = toSrefs(references);
    expect(srefs.next().value).toEqual('A1');
    expect(srefs.next().value).toEqual('B2');
    expect(srefs.next().value).toEqual('C3');
  });

  it('should convert the set of Srng to a generator of Sref', () => {
    const references = new Set(['A1:B2']);
    const srefs = toSrefs(references);
    expect(srefs.next().value).toEqual('A1');
    expect(srefs.next().value).toEqual('B1');
    expect(srefs.next().value).toEqual('A2');
    expect(srefs.next().value).toEqual('B2');
  });
});

describe('toBorderRanges', () => {
  it('should return the border ranges for the given range', () => {
    const range: Range = [
      { r: 2, c: 2 },
      { r: 3, c: 3 },
    ];

    const dimension: Range = [
      { r: 1, c: 1 },
      { r: 4, c: 4 },
    ];

    expect(toBorderRanges(range, dimension)).toEqual([
      [
        { r: 1, c: 2 },
        { r: 1, c: 3 },
      ],
      [
        { r: 4, c: 2 },
        { r: 4, c: 3 },
      ],
      [
        { r: 2, c: 1 },
        { r: 3, c: 1 },
      ],
      [
        { r: 2, c: 4 },
        { r: 3, c: 4 },
      ],
    ]);
  });

  it('should exclude the border ranges that are outside the dimension', () => {
    const range: Range = [
      { r: 1, c: 1 },
      { r: 1, c: 1 },
    ];

    const dimension: Range = [
      { r: 1, c: 1 },
      { r: 1, c: 1 },
    ];

    expect(toBorderRanges(range, dimension)).toEqual([]);
  });
});
