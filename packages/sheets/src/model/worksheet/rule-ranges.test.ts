import { describe, it, expect } from 'vitest';
import { shiftBoundary, clampRange } from './rule-ranges';

describe('rule-ranges primitives', () => {
  it('shiftBoundary shifts indices at/after an insert point', () => {
    expect(shiftBoundary(3, 1, 2)).toBe(5); // insert 2 rows at 1
    expect(shiftBoundary(1, 3, 2)).toBe(1); // before insert point: unchanged
  });

  it('shiftBoundary collapses deleted indices to the boundary', () => {
    // delete 3 rows at index 3: rows 3,4,5 removed
    expect(shiftBoundary(3, 3, -3)).toBe(3);
    expect(shiftBoundary(5, 3, -3)).toBe(3);
    expect(shiftBoundary(6, 3, -3)).toBe(3); // row after deletion shifts up
  });

  it('clampRange raises sub-1 boundaries to 1', () => {
    const r = clampRange([
      { r: 0, c: 0 },
      { r: 4, c: 2 },
    ]);
    expect(r[0]).toEqual({ r: 1, c: 1 });
  });
});
