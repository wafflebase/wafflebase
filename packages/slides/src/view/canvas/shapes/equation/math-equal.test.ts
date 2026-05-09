import { describe, it, expect } from 'vitest';
import '../../test-canvas-env';
import { createTestCanvas } from '../../test-canvas-env';
import { buildMathEqual } from './math-equal';

describe('buildMathEqual', () => {
  it('produces a `=` glyph composed of two parallel bars with a gap', () => {
    const path = buildMathEqual({ w: 60, h: 60 });
    const ctx = createTestCanvas(120, 120).getContext('2d');
    // With defaults [23520, 11760] over h=60: bar 14.112, gap 7.056.
    // Top bar y ∈ [12.36, 26.47]; bottom bar y ∈ [33.53, 47.64].
    expect(ctx.isPointInPath(path, 30, 20)).toBe(true); // inside top bar
    expect(ctx.isPointInPath(path, 30, 40)).toBe(true); // inside bottom bar
    expect(ctx.isPointInPath(path, 30, 30)).toBe(false); // in the gap
  });
});
