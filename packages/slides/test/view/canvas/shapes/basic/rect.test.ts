import { describe, it, expect } from 'vitest';
import '../../../../../src/view/canvas/test-canvas-env';
import { createTestCanvas } from '../../../../../src/view/canvas/test-canvas-env';
import { buildRect } from '../../../../../src/view/canvas/shapes/basic/rect';

describe('buildRect', () => {
  it('returns a rectangular Path2D covering the frame', () => {
    const path = buildRect({ w: 100, h: 60 });
    const ctx = createTestCanvas(200, 200).getContext('2d');
    expect(ctx.isPointInPath(path, 50, 30)).toBe(true); // centre
    expect(ctx.isPointInPath(path, 0, 0)).toBe(true); // corner (inclusive)
    expect(ctx.isPointInPath(path, 99, 59)).toBe(true); // far corner
    expect(ctx.isPointInPath(path, 101, 30)).toBe(false); // outside right
    expect(ctx.isPointInPath(path, 50, 61)).toBe(false); // outside bottom
  });

  it('handles 0×0 frames without throwing', () => {
    expect(() => buildRect({ w: 0, h: 0 })).not.toThrow();
  });
});
