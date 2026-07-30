import { describe, it, expect } from 'vitest';
import { Range, Ranges } from './types';
import {
  toRanges,
  inRanges,
  isIntersectRanges,
  toRefsFromRanges,
  toSrngFromRanges,
  parseRanges,
  mergeOverlapping,
  removeRange,
  isUnboundedRange,
  resolveRange,
} from './coordinates';

describe('Ranges utilities', () => {
  // Helper to create a range from row/col shorthand
  const r = (r1: number, c1: number, r2: number, c2: number): Range => [
    { r: r1, c: c1 },
    { r: r2, c: c2 },
  ];

  describe('toRanges', () => {
    it('should normalize ranges (swap if needed)', () => {
      const result = toRanges(
        [{ r: 3, c: 2 }, { r: 1, c: 1 }],
      );
      expect(result).toEqual([r(1, 1, 3, 2)]);
    });

    it('should handle multiple ranges', () => {
      const result = toRanges(r(1, 1, 2, 2), r(5, 5, 6, 6));
      expect(result).toHaveLength(2);
    });

    it('should return empty array for no arguments', () => {
      expect(toRanges()).toEqual([]);
    });
  });

  describe('inRanges', () => {
    const ranges: Ranges = [r(1, 1, 2, 2), r(5, 5, 6, 6)];

    it('should return true for ref in first range', () => {
      expect(inRanges({ r: 1, c: 1 }, ranges)).toBe(true);
    });

    it('should return true for ref in second range', () => {
      expect(inRanges({ r: 6, c: 6 }, ranges)).toBe(true);
    });

    it('should return false for ref outside all ranges', () => {
      expect(inRanges({ r: 3, c: 3 }, ranges)).toBe(false);
    });

    it('should return false for empty ranges', () => {
      expect(inRanges({ r: 1, c: 1 }, [])).toBe(false);
    });
  });

  describe('isIntersectRanges', () => {
    it('should return true when ranges overlap', () => {
      const a: Ranges = [r(1, 1, 3, 3)];
      const b: Ranges = [r(2, 2, 4, 4)];
      expect(isIntersectRanges(a, b)).toBe(true);
    });

    it('should return false when ranges do not overlap', () => {
      const a: Ranges = [r(1, 1, 2, 2)];
      const b: Ranges = [r(5, 5, 6, 6)];
      expect(isIntersectRanges(a, b)).toBe(false);
    });

    it('should check all pairs', () => {
      const a: Ranges = [r(1, 1, 2, 2), r(10, 10, 11, 11)];
      const b: Ranges = [r(5, 5, 6, 6), r(10, 10, 10, 10)];
      expect(isIntersectRanges(a, b)).toBe(true);
    });

    it('should return false for empty ranges', () => {
      expect(isIntersectRanges([], [r(1, 1, 2, 2)])).toBe(false);
    });
  });

  describe('toRefsFromRanges', () => {
    it('should yield all refs across multiple ranges', () => {
      const ranges: Ranges = [r(1, 1, 1, 2), r(3, 1, 3, 1)];
      const refs = Array.from(toRefsFromRanges(ranges));
      expect(refs).toEqual([
        { r: 1, c: 1 },
        { r: 1, c: 2 },
        { r: 3, c: 1 },
      ]);
    });

    it('should yield nothing for empty ranges', () => {
      expect(Array.from(toRefsFromRanges([]))).toEqual([]);
    });
  });

  describe('toSrngFromRanges', () => {
    it('should serialize multiple ranges with commas', () => {
      const ranges: Ranges = [r(1, 1, 1, 2), r(2, 2, 3, 3)];
      expect(toSrngFromRanges(ranges)).toBe('A1:B1,B2:C3');
    });

    it('should serialize single-cell range without colon', () => {
      const ranges: Ranges = [r(1, 1, 1, 1)];
      expect(toSrngFromRanges(ranges)).toBe('A1');
    });

    it('should return empty string for empty ranges', () => {
      expect(toSrngFromRanges([])).toBe('');
    });

    it('should mix single-cell and multi-cell ranges', () => {
      const ranges: Ranges = [r(1, 1, 1, 2), r(2, 2, 2, 2), r(3, 1, 4, 3)];
      expect(toSrngFromRanges(ranges)).toBe('A1:B1,B2,A3:C4');
    });
  });

  describe('parseRanges', () => {
    it('should parse comma-separated ranges', () => {
      const result = parseRanges('A1:B2,C3:D4');
      expect(result).toEqual([r(1, 1, 2, 2), r(3, 3, 4, 4)]);
    });

    it('should parse single-cell references', () => {
      const result = parseRanges('A1,B2');
      expect(result).toEqual([r(1, 1, 1, 1), r(2, 2, 2, 2)]);
    });

    it('should parse mixed format', () => {
      const result = parseRanges('A1:A2,B1,B2:B3');
      expect(result).toHaveLength(3);
      expect(result[0]).toEqual(r(1, 1, 2, 1));
      expect(result[1]).toEqual(r(1, 2, 1, 2));
      expect(result[2]).toEqual(r(2, 2, 3, 2));
    });

    it('should handle whitespace', () => {
      const result = parseRanges('A1:B2 , C3');
      expect(result).toEqual([r(1, 1, 2, 2), r(3, 3, 3, 3)]);
    });

    it('should return empty array for empty string', () => {
      expect(parseRanges('')).toEqual([]);
      expect(parseRanges('  ')).toEqual([]);
    });
  });

  describe('parseRanges and toSrngFromRanges roundtrip', () => {
    it('should roundtrip empty ranges', () => {
      expect(parseRanges(toSrngFromRanges([]))).toEqual([]);
    });

    it('should roundtrip correctly', () => {
      const input = 'A1:B2,C3,D4:E5';
      const parsed = parseRanges(input);
      const serialized = toSrngFromRanges(parsed);
      expect(serialized).toBe(input);
    });
  });

  describe('mergeOverlapping', () => {
    it('should merge overlapping ranges', () => {
      const ranges: Ranges = [r(1, 1, 3, 3), r(2, 2, 4, 4)];
      const result = mergeOverlapping(ranges);
      expect(result).toEqual([r(1, 1, 4, 4)]);
    });

    it('should merge adjacent ranges with same columns', () => {
      const ranges: Ranges = [r(1, 1, 2, 3), r(3, 1, 4, 3)];
      const result = mergeOverlapping(ranges);
      expect(result).toEqual([r(1, 1, 4, 3)]);
    });

    it('should merge adjacent ranges with same rows', () => {
      const ranges: Ranges = [r(1, 1, 3, 2), r(1, 3, 3, 4)];
      const result = mergeOverlapping(ranges);
      expect(result).toEqual([r(1, 1, 3, 4)]);
    });

    it('should not merge non-overlapping ranges', () => {
      const ranges: Ranges = [r(1, 1, 2, 2), r(5, 5, 6, 6)];
      const result = mergeOverlapping(ranges);
      expect(result).toHaveLength(2);
    });

    it('should handle empty input', () => {
      expect(mergeOverlapping([])).toEqual([]);
    });

    it('should handle single range', () => {
      const result = mergeOverlapping([r(1, 1, 2, 2)]);
      expect(result).toEqual([r(1, 1, 2, 2)]);
    });

    it('should merge multiple overlapping ranges', () => {
      const ranges: Ranges = [r(1, 1, 3, 3), r(2, 2, 5, 5), r(4, 4, 6, 6)];
      const result = mergeOverlapping(ranges);
      expect(result).toEqual([r(1, 1, 6, 6)]);
    });
  });

  describe('removeRange', () => {
    it('should remove matching range', () => {
      const ranges: Ranges = [r(1, 1, 2, 2), r(3, 3, 4, 4)];
      const result = removeRange(ranges, r(1, 1, 2, 2));
      expect(result).toEqual([r(3, 3, 4, 4)]);
    });

    it('should not remove non-matching range', () => {
      const ranges: Ranges = [r(1, 1, 2, 2), r(3, 3, 4, 4)];
      const result = removeRange(ranges, r(5, 5, 6, 6));
      expect(result).toHaveLength(2);
    });

    it('should remove all matching ranges', () => {
      const ranges: Ranges = [r(1, 1, 2, 2), r(1, 1, 2, 2)];
      const result = removeRange(ranges, r(1, 1, 2, 2));
      expect(result).toEqual([]);
    });

    it('should return empty array when removing from empty', () => {
      expect(removeRange([], r(1, 1, 2, 2))).toEqual([]);
    });
  });

  describe('isUnboundedRange', () => {
    it('detects whole-column, whole-row, and open-ended ranges', () => {
      expect(isUnboundedRange('A:A')).toBe(true);
      expect(isUnboundedRange('A:C')).toBe(true);
      expect(isUnboundedRange('1:1')).toBe(true);
      expect(isUnboundedRange('2:5')).toBe(true);
      expect(isUnboundedRange('A1:B')).toBe(true);
      expect(isUnboundedRange('B2:B')).toBe(true);
      expect(isUnboundedRange('A:B2')).toBe(true);
      expect(isUnboundedRange('$A:$A')).toBe(true);
    });

    it('returns false for bounded ranges and single cells', () => {
      expect(isUnboundedRange('A1:B2')).toBe(false);
      expect(isUnboundedRange('$A$1:$B$2')).toBe(false);
      expect(isUnboundedRange('A1')).toBe(false);
      expect(isUnboundedRange('A')).toBe(false);
    });
  });

  describe('resolveRange', () => {
    const bounds = r(1, 1, 3, 2); // maxR=3, maxC=2

    it('clamps a whole column to the data extent', () => {
      expect(resolveRange('A:A', bounds)).toEqual(r(1, 1, 3, 1));
      expect(resolveRange('A:C', bounds)).toEqual(r(1, 1, 3, 3));
    });

    it('clamps a whole row to the data extent', () => {
      expect(resolveRange('1:1', bounds)).toEqual(r(1, 1, 1, 2));
      expect(resolveRange('2:5', bounds)).toEqual(r(2, 1, 5, 2));
    });

    it('clamps open-ended ranges', () => {
      expect(resolveRange('A1:B', bounds)).toEqual(r(1, 1, 3, 2));
      expect(resolveRange('B2:B', bounds)).toEqual(r(2, 2, 3, 2));
      expect(resolveRange('A:B2', bounds)).toEqual(r(1, 1, 2, 2));
    });

    it('passes bounded ranges through (normalized)', () => {
      expect(resolveRange('A1:B2', bounds)).toEqual(r(1, 1, 2, 2));
    });
  });
});
