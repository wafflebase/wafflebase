import { describe, it, expect } from 'vitest';
import { MATH_DIVIDE_HANDLES } from '../../../../../src/view/canvas/shapes/equation/math-divide';

describe('MATH_DIVIDE_HANDLES', () => {
  it('registers bar, dot-radius, and gap handles', () => {
    expect(MATH_DIVIDE_HANDLES).toHaveLength(3);
    // bar=23.52, dotR=5.88, gap=11.76; bar-top y = 50 - 11.76 = 38.24
    const p0 = MATH_DIVIDE_HANDLES[0].position(
      { w: 200, h: 100 },
      [23520, 5880, 11760],
    );
    expect(p0.y).toBeCloseTo(38.24, 2);
    // top-dot right edge at (cx + dotR, dotY); dotY = 50 - 11.76 - 11.76 - 5.88 = 20.6
    const p1 = MATH_DIVIDE_HANDLES[1].position(
      { w: 200, h: 100 },
      [23520, 5880, 11760],
    );
    expect(p1.x).toBeCloseTo(105.88, 2);
    expect(p1.y).toBeCloseTo(20.6, 2);
  });
});
