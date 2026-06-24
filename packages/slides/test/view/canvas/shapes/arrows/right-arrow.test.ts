import { describe, it, expect } from 'vitest';
import '../../../../../src/view/canvas/test-canvas-env';
import { createTestCanvas } from '../../../../../src/view/canvas/test-canvas-env';
import { buildRightArrow } from '../../../../../src/view/canvas/shapes/arrows/right-arrow';

// OOXML rightArrow at w=100, h=60, default adj (50000/50000):
//   ss = min(w, h) = 60
//   headLen = ss * adj2 / 100000 = 30  → head base at x = w - 30 = 70
//   headHalf = adj1 / 100000 * (h/2) = 15 → shaft spans y ∈ [15, 45]
//   tip at (100, 30); wings span the full height (y 0..60) at the head base.
describe('buildRightArrow', () => {
  it('produces a right-pointing arrow with default head dimensions', () => {
    const path = buildRightArrow({ w: 100, h: 60 });
    const ctx = createTestCanvas(200, 200).getContext('2d');
    // Shaft interior.
    expect(ctx.isPointInPath(path, 10, 30)).toBe(true);
    // Near the tip, on the centerline.
    expect(ctx.isPointInPath(path, 95, 30)).toBe(true);
    // Above the shaft, before the head — outside.
    expect(ctx.isPointInPath(path, 1, 1)).toBe(false);
    // Near the tip but off the centerline — the head has tapered, outside.
    expect(ctx.isPointInPath(path, 95, 1)).toBe(false);
  });

  it('head wings extend beyond the shaft edge', () => {
    const path = buildRightArrow({ w: 100, h: 60 });
    const ctx = createTestCanvas(200, 200).getContext('2d');
    // At x=72 (just past the head base x=70) the head covers y≈2..58,
    // far wider than the shaft band y∈[15,45]. A point at y=5 is inside the
    // head wing but would be outside a plain shaft — proving head > shaft.
    expect(ctx.isPointInPath(path, 72, 5)).toBe(true);
    // The same x in a bare shaft (y just inside the band) is also inside.
    expect(ctx.isPointInPath(path, 72, 30)).toBe(true);
    // Just left of the head base, off the shaft band, is outside.
    expect(ctx.isPointInPath(path, 68, 5)).toBe(false);
  });

  it('head length scales by the shorter side (ss), not width', () => {
    // Wide box: w=200, h=60 → ss=60, headLen=30, head base at x=170.
    const path = buildRightArrow({ w: 200, h: 60 });
    const ctx = createTestCanvas(300, 300).getContext('2d');
    // x=160 is still in the shaft (left of the head base 170).
    expect(ctx.isPointInPath(path, 160, 30)).toBe(true);
    // Far off the centerline at x=160 is outside (no head there).
    expect(ctx.isPointInPath(path, 160, 5)).toBe(false);
  });
});
