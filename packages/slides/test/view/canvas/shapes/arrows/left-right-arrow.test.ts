import { describe, it, expect } from 'vitest';
import '../../../../../src/view/canvas/test-canvas-env';
import { createTestCanvas } from '../../../../../src/view/canvas/test-canvas-env';
import { buildLeftRightArrow } from '../../../../../src/view/canvas/shapes/arrows/left-right-arrow';

// OOXML leftRightArrow at w=120, h=60, default adj (50000/50000):
//   ss = min(w, h) = 60
//   head = ss * adj2 / 100000 = 30 (capped at w/2)
//     → left head base x=30, right head base x = w - 30 = 90
//   headHalf = adj1 / 100000 * (h/2) = 15 → shaft spans y ∈ [15, 45]
//   tips at (0, 30) and (120, 30); each head spans full height at its base.
describe('buildLeftRightArrow', () => {
  it('produces a double-headed horizontal arrow', () => {
    const path = buildLeftRightArrow({ w: 120, h: 60 });
    const ctx = createTestCanvas(200, 200).getContext('2d');
    // Center shaft.
    expect(ctx.isPointInPath(path, 60, 30)).toBe(true);
    // Near the left tip, on the centerline.
    expect(ctx.isPointInPath(path, 5, 30)).toBe(true);
    // Near the right tip, on the centerline.
    expect(ctx.isPointInPath(path, 115, 30)).toBe(true);
    // Off the centerline near the left tip — outside the tapered head.
    expect(ctx.isPointInPath(path, 5, 1)).toBe(false);
  });

  it('both head wings extend beyond the shaft edge', () => {
    const path = buildLeftRightArrow({ w: 120, h: 60 });
    const ctx = createTestCanvas(200, 200).getContext('2d');
    // Left head wing: at x=28 the head covers y≈2..58, wider than the
    // shaft band y∈[15,45]; a point at y=5 is inside the wing.
    expect(ctx.isPointInPath(path, 28, 5)).toBe(true);
    // Right head wing, symmetric.
    expect(ctx.isPointInPath(path, 92, 5)).toBe(true);
    // Inside the shaft x-range but off the shaft band is outside.
    expect(ctx.isPointInPath(path, 60, 5)).toBe(false);
  });

  it('head length scales by the shorter side (ss), not width', () => {
    // Wide box: w=240, h=60 → ss=60, head=30, bases at x=30 and x=210.
    const path = buildLeftRightArrow({ w: 240, h: 60 });
    const ctx = createTestCanvas(400, 400).getContext('2d');
    // The middle shaft is long and thin between the two heads.
    expect(ctx.isPointInPath(path, 120, 30)).toBe(true);
    // x=40 is in the shaft, off-centerline has no head.
    expect(ctx.isPointInPath(path, 40, 5)).toBe(false);
  });
});
