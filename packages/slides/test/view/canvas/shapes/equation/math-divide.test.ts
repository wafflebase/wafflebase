import { describe, it, expect } from 'vitest';
import '../../../../../src/view/canvas/test-canvas-env';
import { createTestCanvas } from '../../../../../src/view/canvas/test-canvas-env';
import { buildMathDivide } from '../../../../../src/view/canvas/shapes/equation/math-divide';

describe('buildMathDivide', () => {
  it('produces a `÷` glyph with bar plus two dots (OOXML radius/gap)', () => {
    const path = buildMathDivide({ w: 60, h: 60 });
    const ctx = createTestCanvas(120, 120).getContext('2d');
    // OOXML defaults [23520, radius 11760, gap 5880] over h=60: bar
    // half-thickness dy1 = 7.056 (bar y ∈ [22.94, 37.06]); dot radius
    // 7.056; gap 3.528. Top-dot centre y ≈ 12.36 (top edge ≈ 5.30);
    // bottom-dot centre y ≈ 47.64. Half-width dx1 = 22.047, so the bar
    // spans x ∈ [7.95, 52.05].
    expect(ctx.isPointInPath(path, 30, 30)).toBe(true); // bar centre
    expect(ctx.isPointInPath(path, 30, 12.36)).toBe(true); // top dot centre
    expect(ctx.isPointInPath(path, 30, 47.64)).toBe(true); // bottom dot centre
    expect(ctx.isPointInPath(path, 30, 4)).toBe(false); // above top dot
    expect(ctx.isPointInPath(path, 30, 56)).toBe(false); // below bottom dot
    // The bar no longer reaches the left/right edges.
    expect(ctx.isPointInPath(path, 5, 30)).toBe(false); // beyond bar left reach
    expect(ctx.isPointInPath(path, 50, 30)).toBe(true); // inside bar reach
  });
});
