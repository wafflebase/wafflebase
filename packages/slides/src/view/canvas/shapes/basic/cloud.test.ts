import { describe, it, expect } from 'vitest';
import '../../test-canvas-env';
import { createTestCanvas } from '../../test-canvas-env';
import { buildCloud } from './cloud';

describe('buildCloud', () => {
  it('produces a cloud silhouette covering the centre of the frame', () => {
    const path = buildCloud({ w: 200, h: 120 });
    const ctx = createTestCanvas(400, 400).getContext('2d');
    expect(ctx.isPointInPath(path, 100, 60)).toBe(true);
    expect(ctx.isPointInPath(path, 1, 1)).toBe(false);
    expect(ctx.isPointInPath(path, 199, 1)).toBe(false);
  });
});
