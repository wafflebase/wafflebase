import { describe, it, expect } from 'vitest';
import '../../test-canvas-env';
import { createTestCanvas } from '../../test-canvas-env';
import { buildMathPlus } from './math-plus';

describe('buildMathPlus', () => {
  it('produces a `+` glyph composed of two crossed bars', () => {
    const path = buildMathPlus({ w: 60, h: 60 });
    const ctx = createTestCanvas(120, 120).getContext('2d');
    // With arm thickness 23.52% of min(w,h) = 14.112, bars span
    // y in [22.944, 37.056] (h-bar) and x in [22.944, 37.056] (v-bar).
    expect(ctx.isPointInPath(path, 30, 30)).toBe(true); // centre overlap
    expect(ctx.isPointInPath(path, 5, 30)).toBe(true); // h-bar far left
    expect(ctx.isPointInPath(path, 30, 5)).toBe(true); // v-bar top
    expect(ctx.isPointInPath(path, 5, 5)).toBe(false); // outside both arms
  });
});
