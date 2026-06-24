import { describe, it, expect } from 'vitest';
import '../../../../../src/view/canvas/test-canvas-env';
import { createTestCanvas } from '../../../../../src/view/canvas/test-canvas-env';
import { buildUpArrow } from '../../../../../src/view/canvas/shapes/arrows/up-arrow';

// OOXML upArrow at w=60, h=100, default adj (50000/50000):
//   ss = 60, headLen = ss * adj2 / 100000 = 30 → head base at y = 30
//   headHalf = adj1 / 100000 * (w/2) = 15 → shaft spans x ∈ [15, 45]
//   tip at (30, 0); wings span full width (x 0..60) at the head base y=30.
describe('buildUpArrow', () => {
  it('produces an up-pointing arrow with default head dimensions', () => {
    const path = buildUpArrow({ w: 60, h: 100 });
    const ctx = createTestCanvas(200, 200).getContext('2d');
    // Shaft interior, near the bottom.
    expect(ctx.isPointInPath(path, 30, 95)).toBe(true);
    // Near the tip, on the centerline.
    expect(ctx.isPointInPath(path, 30, 5)).toBe(true);
    // Off the centerline near the top — outside the tapered head.
    expect(ctx.isPointInPath(path, 1, 95)).toBe(false);
  });

  it('head wings extend beyond the shaft edge', () => {
    const path = buildUpArrow({ w: 60, h: 100 });
    const ctx = createTestCanvas(200, 200).getContext('2d');
    // At y=28 (just above the head base y=30) the head covers x≈2..58,
    // far wider than the shaft band x∈[15,45]. A point at x=5 is inside the
    // head wing — proving head > shaft.
    expect(ctx.isPointInPath(path, 5, 28)).toBe(true);
    // Just below the head base, off the shaft band, is outside.
    expect(ctx.isPointInPath(path, 5, 32)).toBe(false);
  });

  it('head length scales by the shorter side (ss), not height', () => {
    // Tall box: w=60, h=200 → ss=60, headLen=30, head base at y=30.
    const path = buildUpArrow({ w: 60, h: 200 });
    const ctx = createTestCanvas(300, 300).getContext('2d');
    // y=40 is in the shaft (below the head base 30).
    expect(ctx.isPointInPath(path, 30, 40)).toBe(true);
    // Off centerline at y=40 has no head — outside.
    expect(ctx.isPointInPath(path, 5, 40)).toBe(false);
  });
});
