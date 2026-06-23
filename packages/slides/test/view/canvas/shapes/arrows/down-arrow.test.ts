import { describe, it, expect } from 'vitest';
import '../../../../../src/view/canvas/test-canvas-env';
import { createTestCanvas } from '../../../../../src/view/canvas/test-canvas-env';
import { buildDownArrow } from '../../../../../src/view/canvas/shapes/arrows/down-arrow';

// OOXML downArrow at w=60, h=100, default adj (50000/50000):
//   ss = 60, headLen = ss * adj2 / 100000 = 30 → head base at y = h - 30 = 70
//   headHalf = adj1 / 100000 * (w/2) = 15 → shaft spans x ∈ [15, 45]
//   tip at (30, 100); wings span full width (x 0..60) at the head base y=70.
describe('buildDownArrow', () => {
  it('produces a down-pointing arrow with default head dimensions', () => {
    const path = buildDownArrow({ w: 60, h: 100 });
    const ctx = createTestCanvas(200, 200).getContext('2d');
    // Shaft interior, near the top.
    expect(ctx.isPointInPath(path, 30, 5)).toBe(true);
    // Near the tip, on the centerline.
    expect(ctx.isPointInPath(path, 30, 95)).toBe(true);
    // Off the centerline near the top — outside the shaft.
    expect(ctx.isPointInPath(path, 1, 5)).toBe(false);
  });

  it('head wings extend beyond the shaft edge', () => {
    const path = buildDownArrow({ w: 60, h: 100 });
    const ctx = createTestCanvas(200, 200).getContext('2d');
    // At y=72 (just below the head base y=70) the head covers x≈2..58,
    // far wider than the shaft band x∈[15,45]. A point at x=5 is inside the
    // head wing — proving head > shaft.
    expect(ctx.isPointInPath(path, 5, 72)).toBe(true);
    // Just above the head base, off the shaft band, is outside.
    expect(ctx.isPointInPath(path, 5, 68)).toBe(false);
  });

  it('head length scales by the shorter side (ss), not height', () => {
    // Tall box: w=60, h=200 → ss=60, headLen=30, head base at y=170.
    const path = buildDownArrow({ w: 60, h: 200 });
    const ctx = createTestCanvas(300, 300).getContext('2d');
    // y=160 is in the shaft (above the head base 170).
    expect(ctx.isPointInPath(path, 30, 160)).toBe(true);
    // Off centerline at y=160 has no head — outside.
    expect(ctx.isPointInPath(path, 5, 160)).toBe(false);
  });
});
