import { describe, it, expect } from 'vitest';
import { MATH_EQUAL_HANDLES } from '../../../../../src/view/canvas/shapes/equation/math-equal';

describe('MATH_EQUAL_HANDLES', () => {
  it('registers thickness and gap handles', () => {
    expect(MATH_EQUAL_HANDLES).toHaveLength(2);
    // bar = 23.52, gap = 11.76; upper-bar top y = 50 - 5.88 - 23.52 = 20.6
    const p0 = MATH_EQUAL_HANDLES[0].position({ w: 200, h: 100 }, [23520, 11760]);
    expect(p0.x).toBe(100);
    expect(p0.y).toBeCloseTo(20.6, 2);
    // upper-bar bottom (gap top) y = 50 - 5.88 = 44.12
    const p1 = MATH_EQUAL_HANDLES[1].position({ w: 200, h: 100 }, [23520, 11760]);
    expect(p1.y).toBeCloseTo(44.12, 2);
  });
});
