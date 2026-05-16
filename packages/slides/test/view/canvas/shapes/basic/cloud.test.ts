import { describe, it, expect } from 'vitest';
import '../../../../../src/view/canvas/test-canvas-env';
import { createTestCanvas } from '../../../../../src/view/canvas/test-canvas-env';
import { buildCloud } from '../../../../../src/view/canvas/shapes/basic/cloud';

describe('buildCloud', () => {
  it('produces a cloud silhouette covering the centre of the frame', () => {
    const path = buildCloud({ w: 200, h: 120 });
    const ctx = createTestCanvas(400, 400).getContext('2d');
    expect(ctx.isPointInPath(path, 100, 60)).toBe(true);
    expect(ctx.isPointInPath(path, 1, 1)).toBe(false);
    expect(ctx.isPointInPath(path, 199, 1)).toBe(false);
  });
});
