import { describe, it, expect } from 'vitest';
import '../../../../../src/view/canvas/test-canvas-env';
import { createTestCanvas } from '../../../../../src/view/canvas/test-canvas-env';
import { buildRtTriangle } from '../../../../../src/view/canvas/shapes/basic/rt-triangle';

describe('buildRtTriangle', () => {
  it('produces a right triangle with right angle at bottom-left', () => {
    const path = buildRtTriangle({ w: 100, h: 60 });
    const ctx = createTestCanvas(200, 200).getContext('2d');
    expect(ctx.isPointInPath(path, 10, 50)).toBe(true);
    expect(ctx.isPointInPath(path, 5, 30)).toBe(true);
    expect(ctx.isPointInPath(path, 50, 10)).toBe(false);
    expect(ctx.isPointInPath(path, 90, 10)).toBe(false);
  });
});
