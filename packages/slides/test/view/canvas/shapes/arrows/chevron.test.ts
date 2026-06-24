import { describe, it, expect } from 'vitest';
import '../../../../../src/view/canvas/test-canvas-env';
import { createTestCanvas } from '../../../../../src/view/canvas/test-canvas-env';
import { buildChevron, CHEVRON_HANDLES } from '../../../../../src/view/canvas/shapes/arrows/chevron';

describe('buildChevron', () => {
  it('uses OOXML direct notch depth x1 = ss*adj/100000', () => {
    // On a 100×100 frame, ss=100 and adj=50000 → back-notch tip at
    // x1=50 (mid frame). The old builder used adj*(h/2)*(w/h) → x1≈25,
    // a shallower notch. A point at (40, 50) is INSIDE the notch (i.e.
    // OUTSIDE the body) only with the deeper OOXML notch.
    const path = buildChevron({ w: 100, h: 100 });
    const ctx = createTestCanvas(200, 200).getContext('2d');
    // Centerline beyond the notch tip is filled body.
    expect(ctx.isPointInPath(path, 60, 50)).toBe(true);
    // Right-hand point is filled.
    expect(ctx.isPointInPath(path, 90, 50)).toBe(true);
    // Just left of the deep notch tip (x1=50) → in the back notch.
    expect(ctx.isPointInPath(path, 40, 50)).toBe(false);
    expect(ctx.isPointInPath(path, -1, -1)).toBe(false);
  });

  it('handle paints at the front-point inset x2 = w - x1', () => {
    expect(CHEVRON_HANDLES).toHaveLength(1);
    // ss=100, adj=50000 → x1=50, x2=w-x1=50.
    const p = CHEVRON_HANDLES[0].position({ w: 100, h: 100 }, [50000]);
    expect(p.x).toBeCloseTo(50, 5);
    expect(p.y).toBeCloseTo(50, 5);
  });
});
