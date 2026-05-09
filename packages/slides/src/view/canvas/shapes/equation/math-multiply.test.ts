import { describe, it, expect } from 'vitest';
import '../../test-canvas-env';
import { createTestCanvas } from '../../test-canvas-env';
import { buildMathMultiply } from './math-multiply';

describe('buildMathMultiply', () => {
  it('produces an `×` glyph composed of two diagonal arms', () => {
    const path = buildMathMultiply({ w: 60, h: 60 });
    const ctx = createTestCanvas(120, 120).getContext('2d');
    expect(ctx.isPointInPath(path, 30, 30)).toBe(true); // centre overlap
    expect(ctx.isPointInPath(path, 10, 10)).toBe(true); // near TL on TL→BR arm
    expect(ctx.isPointInPath(path, 30, 10)).toBe(false); // above centre, off both arms
  });
});
