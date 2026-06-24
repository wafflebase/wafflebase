import { describe, it, expect } from 'vitest';
import '../../../../../src/view/canvas/test-canvas-env';
import { createTestCanvas } from '../../../../../src/view/canvas/test-canvas-env';
import { buildMathPlus } from '../../../../../src/view/canvas/shapes/equation/math-plus';

describe('buildMathPlus', () => {
  it('produces a `+` glyph whose bars span only the inner 73.49%', () => {
    const path = buildMathPlus({ w: 60, h: 60 });
    const ctx = createTestCanvas(120, 120).getContext('2d');
    // OOXML: dx1 = w*73490/200000 = 22.047, so the h-bar spans
    // x ∈ [7.95, 52.05] — NOT the full width. Arm half-thickness
    // dx2 = 7.056, so the v-bar spans x ∈ [22.94, 37.06] and runs
    // y ∈ [7.95, 52.05].
    expect(ctx.isPointInPath(path, 30, 30)).toBe(true); // centre overlap
    expect(ctx.isPointInPath(path, 50, 30)).toBe(true); // h-bar, inside reach
    expect(ctx.isPointInPath(path, 30, 50)).toBe(true); // v-bar, inside reach
    // The bar no longer reaches the frame edges.
    expect(ctx.isPointInPath(path, 5, 30)).toBe(false); // beyond h-bar left
    expect(ctx.isPointInPath(path, 30, 5)).toBe(false); // beyond v-bar top
    expect(ctx.isPointInPath(path, 5, 5)).toBe(false); // outside both arms
  });
});
