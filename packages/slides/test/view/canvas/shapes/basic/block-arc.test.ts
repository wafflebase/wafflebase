import { describe, it, expect } from 'vitest';
import '../../../../../src/view/canvas/test-canvas-env';
import { createTestCanvas } from '../../../../../src/view/canvas/test-canvas-env';
import { BLOCK_ARC_ADJUSTMENTS, buildBlockArc } from '../../../../../src/view/canvas/shapes/basic/block-arc';

describe('buildBlockArc', () => {
  it('default 180°→0° at 25% thickness fills the top semi-annulus', () => {
    const path = buildBlockArc({ w: 100, h: 100 });
    const ctx = createTestCanvas(200, 200).getContext('2d');
    // Outer-band point near top edge (CW sweep 180°→0° goes through
    // 270° = top).
    expect(ctx.isPointInPath(path, 50, 5)).toBe(true);
    // Pivot is inside the inner hole — outside the band.
    expect(ctx.isPointInPath(path, 50, 50)).toBe(false);
  });

  it('defaults match OOXML preset (180°, 0°, 25%)', () => {
    expect(BLOCK_ARC_ADJUSTMENTS[0].defaultValue).toBe(10800000);
    expect(BLOCK_ARC_ADJUSTMENTS[1].defaultValue).toBe(0);
    expect(BLOCK_ARC_ADJUSTMENTS[2].defaultValue).toBe(25000);
  });
});
