import { describe, it, expect } from 'vitest';
import '../../../../../src/view/canvas/test-canvas-env';
import { createTestCanvas } from '../../../../../src/view/canvas/test-canvas-env';
import { buildMathMinus } from '../../../../../src/view/canvas/shapes/equation/math-minus';

describe('buildMathMinus', () => {
  it('produces a horizontal bar spanning only the inner 73.49%', () => {
    const path = buildMathMinus({ w: 60, h: 60 });
    const ctx = createTestCanvas(120, 120).getContext('2d');
    // OOXML: half-thickness dy1 = h*23520/200000 = 7.056, so the bar
    // spans y ∈ [22.94, 37.06]; half-width dx1 = 22.047, so it spans
    // x ∈ [7.95, 52.05] — NOT the full width.
    expect(ctx.isPointInPath(path, 30, 30)).toBe(true); // bar centre
    expect(ctx.isPointInPath(path, 50, 30)).toBe(true); // inside right reach
    expect(ctx.isPointInPath(path, 30, 5)).toBe(false); // above bar
    expect(ctx.isPointInPath(path, 30, 55)).toBe(false); // below bar
    // The bar no longer reaches the left/right edges.
    expect(ctx.isPointInPath(path, 5, 30)).toBe(false); // beyond left reach
  });
});
