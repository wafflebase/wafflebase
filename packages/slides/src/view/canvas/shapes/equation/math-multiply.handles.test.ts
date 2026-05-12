import { describe, it, expect } from 'vitest';
import { MATH_MULTIPLY_HANDLES } from './math-multiply';

describe('MATH_MULTIPLY_HANDLES', () => {
  it('registers a single arm-thickness handle on the rotated cross', () => {
    expect(MATH_MULTIPLY_HANDLES).toHaveLength(1);
    // t = 23520/100000 * 100 = 23.52; y = 50 - 23.52 * SQRT1_2 ≈ 33.37
    const p = MATH_MULTIPLY_HANDLES[0].position({ w: 200, h: 100 }, [23520]);
    expect(p.x).toBe(100);
    expect(p.y).toBeCloseTo(50 - 23.52 * Math.SQRT1_2, 2);
  });
});
