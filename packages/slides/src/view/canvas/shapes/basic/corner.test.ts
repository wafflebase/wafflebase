import { describe, it, expect } from 'vitest';
import '../../test-canvas-env';
import { createTestCanvas } from '../../test-canvas-env';
import { buildCorner, CORNER_ADJUSTMENTS, CORNER_HANDLES } from './corner';

describe('buildCorner', () => {
  it('fills the bottom + left arms but not the NE quadrant interior', () => {
    const path = buildCorner({ w: 100, h: 100 });
    const ctx = createTestCanvas(200, 200).getContext('2d');
    // Bottom arm interior.
    expect(ctx.isPointInPath(path, 50, 95)).toBe(true);
    // Left arm interior.
    expect(ctx.isPointInPath(path, 5, 50)).toBe(true);
    // NE quadrant — outside.
    expect(ctx.isPointInPath(path, 80, 20)).toBe(false);
  });

  it('defaults are 33333 / 33333', () => {
    expect(CORNER_ADJUSTMENTS[0].defaultValue).toBe(33333);
    expect(CORNER_ADJUSTMENTS[1].defaultValue).toBe(33333);
  });
});

describe('CORNER_HANDLES', () => {
  it('exposes two handles', () => {
    expect(CORNER_HANDLES.length).toBe(2);
  });
});
