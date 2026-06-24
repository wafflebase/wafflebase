import { describe, it, expect } from 'vitest';
import '../../../../../src/view/canvas/test-canvas-env';
import { createTestCanvas } from '../../../../../src/view/canvas/test-canvas-env';
import { buildMathEqual } from '../../../../../src/view/canvas/shapes/equation/math-equal';

describe('buildMathEqual', () => {
  it('produces a `=` glyph whose bars span only the inner 73.49%', () => {
    const path = buildMathEqual({ w: 60, h: 60 });
    const ctx = createTestCanvas(120, 120).getContext('2d');
    // With defaults [23520, 11760] over h=60: bar 14.112, gap 7.056.
    // Top bar y ∈ [12.36, 26.47]; bottom bar y ∈ [33.53, 47.64].
    // Half-width dx1 = 22.047, so bars span x ∈ [7.95, 52.05].
    expect(ctx.isPointInPath(path, 30, 20)).toBe(true); // inside top bar
    expect(ctx.isPointInPath(path, 30, 40)).toBe(true); // inside bottom bar
    expect(ctx.isPointInPath(path, 30, 30)).toBe(false); // in the gap
    // The bars no longer reach the left/right edges.
    expect(ctx.isPointInPath(path, 5, 20)).toBe(false); // beyond top-bar left
    expect(ctx.isPointInPath(path, 50, 20)).toBe(true); // inside top-bar reach
  });
});
