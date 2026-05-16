import { describe, it, expect } from 'vitest';
import '../../../../../src/view/canvas/test-canvas-env';
import { createTestCanvas } from '../../../../../src/view/canvas/test-canvas-env';
import { buildHexagon } from '../../../../../src/view/canvas/shapes/basic/hexagon';

describe('buildHexagon', () => {
  it('produces a horizontal hexagon with default 25% notch depth', () => {
    const path = buildHexagon({ w: 100, h: 60 });
    const ctx = createTestCanvas(200, 200).getContext('2d');
    expect(ctx.isPointInPath(path, 50, 30)).toBe(true);
    expect(ctx.isPointInPath(path, 50, 5)).toBe(true);
    expect(ctx.isPointInPath(path, 5, 5)).toBe(false);
    expect(ctx.isPointInPath(path, 95, 5)).toBe(false);
  });
});
