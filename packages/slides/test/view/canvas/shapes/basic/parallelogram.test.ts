import { describe, it, expect } from 'vitest';
import '../../../../../src/view/canvas/test-canvas-env';
import { createTestCanvas } from '../../../../../src/view/canvas/test-canvas-env';
import { buildParallelogram } from '../../../../../src/view/canvas/shapes/basic/parallelogram';

describe('buildParallelogram', () => {
  it('produces a slanted parallelogram with default 25% slant', () => {
    const path = buildParallelogram({ w: 100, h: 60 });
    const ctx = createTestCanvas(200, 200).getContext('2d');
    expect(ctx.isPointInPath(path, 50, 30)).toBe(true);
    expect(ctx.isPointInPath(path, 30, 5)).toBe(true);
    expect(ctx.isPointInPath(path, 70, 55)).toBe(true);
    expect(ctx.isPointInPath(path, 5, 5)).toBe(false);
    expect(ctx.isPointInPath(path, 95, 55)).toBe(false);
  });
});
