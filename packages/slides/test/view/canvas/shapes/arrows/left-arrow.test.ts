import { describe, it, expect } from 'vitest';
import '../../../../../src/view/canvas/test-canvas-env';
import { createTestCanvas } from '../../../../../src/view/canvas/test-canvas-env';
import { buildLeftArrow } from '../../../../../src/view/canvas/shapes/arrows/left-arrow';

// OOXML leftArrow at w=100, h=60, default adj (50000/50000):
//   ss = 60, headLen = ss * adj2 / 100000 = 30 → head base at x = 30
//   headHalf = adj1 / 100000 * (h/2) = 15 → shaft spans y ∈ [15, 45]
//   tip at (0, 30); wings span full height (y 0..60) at the head base x=30.
describe('buildLeftArrow', () => {
  it('produces a left-pointing arrow with default head dimensions', () => {
    const path = buildLeftArrow({ w: 100, h: 60 });
    const ctx = createTestCanvas(200, 200).getContext('2d');
    // Near the tip, on the centerline.
    expect(ctx.isPointInPath(path, 5, 30)).toBe(true);
    // Shaft interior.
    expect(ctx.isPointInPath(path, 90, 30)).toBe(true);
    // Near the tip but off the centerline — outside the tapered head.
    expect(ctx.isPointInPath(path, 5, 1)).toBe(false);
    expect(ctx.isPointInPath(path, 5, 59)).toBe(false);
  });

  it('head wings extend beyond the shaft edge', () => {
    const path = buildLeftArrow({ w: 100, h: 60 });
    const ctx = createTestCanvas(200, 200).getContext('2d');
    // At x=28 (just toward the tip from head base x=30) the head covers
    // y≈2..58, far wider than the shaft band y∈[15,45]. A point at y=5 is
    // inside the head wing — proving head > shaft.
    expect(ctx.isPointInPath(path, 28, 5)).toBe(true);
    // Just right of the head base, off the shaft band, is outside.
    expect(ctx.isPointInPath(path, 32, 5)).toBe(false);
  });

  it('head length scales by the shorter side (ss), not width', () => {
    // Wide box: w=200, h=60 → ss=60, headLen=30, head base at x=30.
    const path = buildLeftArrow({ w: 200, h: 60 });
    const ctx = createTestCanvas(300, 300).getContext('2d');
    // x=40 is in the shaft (right of the head base 30).
    expect(ctx.isPointInPath(path, 40, 30)).toBe(true);
    // Far off centerline at x=40 has no head — outside.
    expect(ctx.isPointInPath(path, 40, 5)).toBe(false);
  });
});
