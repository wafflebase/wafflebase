import { describe, it, expect } from 'vitest';
import '../../../../../src/view/canvas/test-canvas-env';
import { createTestCanvas } from '../../../../../src/view/canvas/test-canvas-env';
import { buildTriangle } from '../../../../../src/view/canvas/shapes/basic/triangle';

describe('buildTriangle', () => {
  it('produces an isoceles triangle with apex centred by default', () => {
    const path = buildTriangle({ w: 100, h: 60 });
    const ctx = createTestCanvas(200, 200).getContext('2d');
    expect(ctx.isPointInPath(path, 50, 50)).toBe(true);
    expect(ctx.isPointInPath(path, 50, 30)).toBe(true);
    expect(ctx.isPointInPath(path, 10, 10)).toBe(false);
    expect(ctx.isPointInPath(path, 90, 10)).toBe(false);
    expect(ctx.isPointInPath(path, 50, -1)).toBe(false);
  });
});
