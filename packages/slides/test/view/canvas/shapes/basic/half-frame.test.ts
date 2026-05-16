import { describe, it, expect } from 'vitest';
import '../../../../../src/view/canvas/test-canvas-env';
import { createTestCanvas } from '../../../../../src/view/canvas/test-canvas-env';
import {
  buildHalfFrame,
  HALF_FRAME_ADJUSTMENTS,
  HALF_FRAME_HANDLES,
} from '../../../../../src/view/canvas/shapes/basic/half-frame';

describe('buildHalfFrame', () => {
  it('fills the top + left arms but not the SE quadrant interior', () => {
    const path = buildHalfFrame({ w: 100, h: 100 });
    const ctx = createTestCanvas(200, 200).getContext('2d');
    // Top arm interior.
    expect(ctx.isPointInPath(path, 50, 5)).toBe(true);
    // Left arm interior.
    expect(ctx.isPointInPath(path, 5, 50)).toBe(true);
    // SE quadrant — outside the L.
    expect(ctx.isPointInPath(path, 80, 80)).toBe(false);
  });

  it('defaults are 33333 / 33333', () => {
    expect(HALF_FRAME_ADJUSTMENTS[0].defaultValue).toBe(33333);
    expect(HALF_FRAME_ADJUSTMENTS[1].defaultValue).toBe(33333);
  });
});

describe('HALF_FRAME_HANDLES', () => {
  it('exposes two handles (top thickness + left thickness)', () => {
    expect(HALF_FRAME_HANDLES.length).toBe(2);
  });

  it('top handle paints on the left edge at y = t1', () => {
    const p = HALF_FRAME_HANDLES[0].position({ w: 100, h: 100 }, [33333, 33333]);
    expect(p.x).toBe(0);
    expect(p.y).toBeCloseTo(33.333, 1);
  });
});
