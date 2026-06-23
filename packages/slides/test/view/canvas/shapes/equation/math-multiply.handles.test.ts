import { describe, it, expect } from 'vitest';
import { MATH_MULTIPLY_HANDLES } from '../../../../../src/view/canvas/shapes/equation/math-multiply';

describe('MATH_MULTIPLY_HANDLES', () => {
  it('anchors the arm-thickness handle on the corner-aligned arm tip', () => {
    expect(MATH_MULTIPLY_HANDLES).toHaveLength(1);
    // The handle sits on the top-left arm's outer corner (xA, yA),
    // which is computed from the box-diagonal angle `at2 w h` — not a
    // fixed 45°. For a 200×100 frame at default thickness 23520 it
    // lands at ≈ (42.78, 34.54).
    const p = MATH_MULTIPLY_HANDLES[0].position({ w: 200, h: 100 }, [23520]);
    expect(p.x).toBeCloseTo(42.78, 2);
    expect(p.y).toBeCloseTo(34.54, 2);
  });
});
