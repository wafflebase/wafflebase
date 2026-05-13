import { describe, it, expect } from 'vitest';
import '../../test-canvas-env';
import { createTestCanvas } from '../../test-canvas-env';
import {
  buildSnip1Rect,
  SNIP1_RECT_ADJUSTMENTS,
  SNIP1_RECT_HANDLES,
} from './snip1-rect';

describe('buildSnip1Rect', () => {
  it('fills the centre and excludes the NE chamfer corner', () => {
    const path = buildSnip1Rect({ w: 100, h: 100 });
    const ctx = createTestCanvas(200, 200).getContext('2d');
    expect(ctx.isPointInPath(path, 50, 50)).toBe(true);
    expect(ctx.isPointInPath(path, 95, 5)).toBe(false);
  });

  it('default cut is 12500', () => {
    expect(SNIP1_RECT_ADJUSTMENTS[0].defaultValue).toBe(12500);
  });
});

describe('SNIP1_RECT_HANDLES', () => {
  it('top-edge handle at x = w - cut', () => {
    const p = SNIP1_RECT_HANDLES[0].position({ w: 100, h: 100 }, [12500]);
    expect(p.y).toBe(0);
    expect(p.x).toBeCloseTo(87.5, 1);
  });
});
