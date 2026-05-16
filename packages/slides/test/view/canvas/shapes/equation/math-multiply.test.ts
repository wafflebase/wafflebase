import { describe, it, expect } from 'vitest';
import '../../../../../src/view/canvas/test-canvas-env';
import { createTestCanvas } from '../../../../../src/view/canvas/test-canvas-env';
import { buildMathMultiply } from '../../../../../src/view/canvas/shapes/equation/math-multiply';

describe('buildMathMultiply', () => {
  it('produces an `×` glyph composed of two diagonal arms', () => {
    const path = buildMathMultiply({ w: 60, h: 60 });
    const ctx = createTestCanvas(120, 120).getContext('2d');
    expect(ctx.isPointInPath(path, 30, 30)).toBe(true); // centre overlap
    expect(ctx.isPointInPath(path, 10, 10)).toBe(true); // near TL on TL→BR arm
    expect(ctx.isPointInPath(path, 30, 10)).toBe(false); // above centre, off both arms
  });
});
