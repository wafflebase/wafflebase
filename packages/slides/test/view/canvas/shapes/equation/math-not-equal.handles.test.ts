import { describe, it, expect } from 'vitest';
import { MATH_NOT_EQUAL_HANDLES } from '../../../../../src/view/canvas/shapes/equation/math-not-equal';
import { MATH_NOT_EQUAL_ADJUSTMENTS } from '../../../../../src/view/canvas/shapes/equation/math-not-equal';

describe('MATH_NOT_EQUAL_HANDLES', () => {
  it('registers bar, gap, and slash-angle handles', () => {
    expect(MATH_NOT_EQUAL_HANDLES).toHaveLength(3);
    // The 3rd adjustment is the slash ANGLE crAng (60000ths of a
    // degree), default 6600000 = 110°, range [70°, 110°].
    expect(MATH_NOT_EQUAL_ADJUSTMENTS[2].defaultValue).toBe(6600000);
    expect(MATH_NOT_EQUAL_ADJUSTMENTS[2].min).toBe(4200000);
    expect(MATH_NOT_EQUAL_ADJUSTMENTS[2].max).toBe(6600000);
    // The slash handle anchors on the slash's upper-left tip. For the
    // default 110° slash over a 200×100 frame it lands at lx ≈ 130.71,
    // ly = 0 (clamped to the 8px top inset).
    const p = MATH_NOT_EQUAL_HANDLES[2].position(
      { w: 200, h: 100 },
      [23520, 11760, 6600000],
    );
    expect(p.x).toBeCloseTo(130.713, 2);
    expect(p.y).toBe(8); // ly = 0 → inset to 8

    // Dragging the slash handle recovers the crAng angle. A pointer
    // straight up from centre (dx = 0) gives a vertical slash → 90°
    // (crAng = 5400000).
    const a = MATH_NOT_EQUAL_HANDLES[2].apply(
      { w: 200, h: 100 },
      [23520, 11760, 6600000],
      { x: 100, y: 0 },
    );
    expect(a[2]).toBe(5400000);
  });
});
