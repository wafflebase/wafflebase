import { describe, it, expect } from 'vitest';
import { MATH_DIVIDE_HANDLES } from '../../../../../src/view/canvas/shapes/equation/math-divide';

describe('MATH_DIVIDE_HANDLES', () => {
  it('registers bar, dot-radius, and gap handles', () => {
    expect(MATH_DIVIDE_HANDLES).toHaveLength(3);
    // OOXML defaults [bar 23520, radius 11760, gap 5880] over h=100:
    // half-bar 11.76 → bar-top y = 50 - 11.76 = 38.24.
    const p0 = MATH_DIVIDE_HANDLES[0].position(
      { w: 200, h: 100 },
      [23520, 11760, 5880],
    );
    expect(p0.y).toBeCloseTo(38.24, 2);
    // dotR = 11.76, gap = 5.88; top-dot right edge at (cx + dotR, dotY)
    // with dotY = 38.24 - 5.88 - 11.76 = 20.6.
    const p1 = MATH_DIVIDE_HANDLES[1].position(
      { w: 200, h: 100 },
      [23520, 11760, 5880],
    );
    expect(p1.x).toBeCloseTo(111.76, 2);
    expect(p1.y).toBeCloseTo(20.6, 2);
  });
});
