import { describe, it, expect } from 'vitest';
import '../../test-canvas-env';
import { createTestCanvas } from '../../test-canvas-env';
import { buildHeart } from './heart';

describe('buildHeart', () => {
  it('fills the lobes and the V interior', () => {
    const path = buildHeart({ w: 100, h: 100 });
    const ctx = createTestCanvas(200, 200).getContext('2d');
    // Centre between lobes (just below the dip).
    expect(ctx.isPointInPath(path, 50, 40)).toBe(true);
    // Outside the heart silhouette (above the lobes).
    expect(ctx.isPointInPath(path, 5, 5)).toBe(false);
  });
});
