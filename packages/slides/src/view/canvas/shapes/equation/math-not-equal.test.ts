import { describe, it, expect } from 'vitest';
import '../../test-canvas-env';
import { createTestCanvas } from '../../test-canvas-env';
import { buildMathNotEqual } from './math-not-equal';

describe('buildMathNotEqual', () => {
  it('produces a `≠` glyph with two bars and a diagonal slash', () => {
    const path = buildMathNotEqual({ w: 60, h: 60 });
    const ctx = createTestCanvas(120, 120).getContext('2d');
    expect(ctx.isPointInPath(path, 30, 20)).toBe(true); // inside top bar
    expect(ctx.isPointInPath(path, 30, 40)).toBe(true); // inside bottom bar
    expect(ctx.isPointInPath(path, 30, 30)).toBe(true); // on the slash
    expect(ctx.isPointInPath(path, 5, 5)).toBe(false); // outside everything
  });
});
