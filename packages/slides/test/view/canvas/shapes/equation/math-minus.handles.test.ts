import { describe, it, expect } from 'vitest';
import { MATH_MINUS_HANDLES } from '../../../../../src/view/canvas/shapes/equation/math-minus';

describe('MATH_MINUS_HANDLES', () => {
  it('registers a single linear-y handle at the top of the bar', () => {
    expect(MATH_MINUS_HANDLES).toHaveLength(1);
    // t = 23520/100000 * min(200, 100) = 23.52; bar top y = 50 - 11.76 = 38.24
    const p = MATH_MINUS_HANDLES[0].position({ w: 200, h: 100 }, [23520]);
    expect(p.x).toBe(100);
    expect(p.y).toBeCloseTo(38.24, 2);
  });
});
