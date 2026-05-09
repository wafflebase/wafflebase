import { describe, it, expect } from 'vitest';
import '../../test-canvas-env';
import { createTestCanvas } from '../../test-canvas-env';
import { buildMathMinus } from './math-minus';

describe('buildMathMinus', () => {
  it('produces a single horizontal bar centered vertically', () => {
    const path = buildMathMinus({ w: 60, h: 60 });
    const ctx = createTestCanvas(120, 120).getContext('2d');
    // With arm thickness 23.52% of min(w,h) = 14.112, the bar spans
    // y in [22.944, 37.056].
    expect(ctx.isPointInPath(path, 30, 30)).toBe(true); // bar centre
    expect(ctx.isPointInPath(path, 30, 5)).toBe(false); // above bar
    expect(ctx.isPointInPath(path, 30, 55)).toBe(false); // below bar
  });
});
