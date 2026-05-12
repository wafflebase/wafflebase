import { describe, it, expect } from 'vitest';
import { MATH_NOT_EQUAL_HANDLES } from './math-not-equal';

describe('MATH_NOT_EQUAL_HANDLES', () => {
  it('registers bar, gap, and slash-thickness handles', () => {
    expect(MATH_NOT_EQUAL_HANDLES).toHaveLength(3);
    // slashT = 6600/100000 * 100 = 6.6; off = (6.6/2) * SQRT1_2 ≈ 2.333
    // slash handle at (100 - 2.333, 50 - 2.333) ≈ (97.667, 47.667)
    const p = MATH_NOT_EQUAL_HANDLES[2].position(
      { w: 200, h: 100 },
      [23520, 11760, 6600],
    );
    expect(p.x).toBeCloseTo(100 - 6.6 / 2 * Math.SQRT1_2, 3);
    expect(p.y).toBeCloseTo(50 - 6.6 / 2 * Math.SQRT1_2, 3);
  });
});
