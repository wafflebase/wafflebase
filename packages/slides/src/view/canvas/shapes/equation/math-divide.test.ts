import { describe, it, expect } from 'vitest';
import '../../test-canvas-env';
import { createTestCanvas } from '../../test-canvas-env';
import { buildMathDivide } from './math-divide';

describe('buildMathDivide', () => {
  it('produces a `÷` glyph with bar plus two dots', () => {
    const path = buildMathDivide({ w: 60, h: 60 });
    const ctx = createTestCanvas(120, 120).getContext('2d');
    // With defaults [23520, 5880, 11760] over h=60: bar half-thickness
    // 7.056; top dot centre y ≈ 12.36; bottom dot centre y ≈ 47.64.
    expect(ctx.isPointInPath(path, 30, 30)).toBe(true); // bar centre
    expect(ctx.isPointInPath(path, 30, 5)).toBe(false); // above top dot
    expect(ctx.isPointInPath(path, 30, 55)).toBe(false); // below bottom dot
  });
});
