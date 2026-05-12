import { describe, it, expect } from 'vitest';
import { MATH_PLUS_HANDLES } from './math-plus';

describe('MATH_PLUS_HANDLES', () => {
  it('registers a single arm-thickness handle', () => {
    expect(MATH_PLUS_HANDLES).toHaveLength(1);
    // t = 23520/100000 * min(200, 100) = 23.52; xL = (200-23.52)/2 = 88.24
    const p = MATH_PLUS_HANDLES[0].position({ w: 200, h: 100 }, [23520]);
    expect(p.x).toBeCloseTo(88.24, 2);
    expect(p.y).toBe(0);
  });
});
