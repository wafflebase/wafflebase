import { describe, it, expect } from 'vitest';
import '../../../../../src/view/canvas/test-canvas-env';
import { createTestCanvas } from '../../../../../src/view/canvas/test-canvas-env';
import { buildQuadArrow } from '../../../../../src/view/canvas/shapes/arrows/quad-arrow';

describe('buildQuadArrow', () => {
  it('produces a four-headed arrow with default head and shaft', () => {
    const path = buildQuadArrow({ w: 100, h: 100 });
    const ctx = createTestCanvas(200, 200).getContext('2d');
    expect(ctx.isPointInPath(path, 50, 50)).toBe(true);
    expect(ctx.isPointInPath(path, 50, 5)).toBe(true);
    expect(ctx.isPointInPath(path, 5, 50)).toBe(true);
    expect(ctx.isPointInPath(path, 5, 5)).toBe(false);
  });
});
