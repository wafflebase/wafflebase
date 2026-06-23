import { describe, it, expect } from 'vitest';
import '../../../../../src/view/canvas/test-canvas-env';
import { createTestCanvas } from '../../../../../src/view/canvas/test-canvas-env';
import { buildMathNotEqual } from '../../../../../src/view/canvas/shapes/equation/math-not-equal';

describe('buildMathNotEqual', () => {
  it('produces a `≠` glyph with two bars and an angled slash', () => {
    const path = buildMathNotEqual({ w: 60, h: 60 });
    const ctx = createTestCanvas(120, 120).getContext('2d');
    // Bars span only the inner 73.49% (dx1 = 22.047 → x ∈ [7.95, 52.05]).
    // Upper bar y ∈ [12.36, 26.47]; lower bar y ∈ [33.53, 47.64]. The
    // slash tilts per crAng = 110° (≈ 20° from vertical), so in the gap
    // row (y = 30) it sits to the RIGHT of centre (≈ x 38-40).
    expect(ctx.isPointInPath(path, 30, 19.4)).toBe(true); // inside top bar
    expect(ctx.isPointInPath(path, 30, 40.6)).toBe(true); // inside bottom bar
    expect(ctx.isPointInPath(path, 39, 30)).toBe(true); // on the angled slash
    expect(ctx.isPointInPath(path, 30, 30)).toBe(false); // gap, off the slash
    expect(ctx.isPointInPath(path, 5, 5)).toBe(false); // outside everything
    // The bars no longer reach the left edge.
    expect(ctx.isPointInPath(path, 5, 19.4)).toBe(false); // beyond top-bar left
  });
});
