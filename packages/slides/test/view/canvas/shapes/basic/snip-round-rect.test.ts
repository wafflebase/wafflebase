import { describe, it, expect } from 'vitest';
import '../../../../../src/view/canvas/test-canvas-env';
import { createTestCanvas } from '../../../../../src/view/canvas/test-canvas-env';
import {
  buildSnipRoundRect,
  SNIP_ROUND_RECT_HANDLES,
} from '../../../../../src/view/canvas/shapes/basic/snip-round-rect';

describe('buildSnipRoundRect', () => {
  it('excludes NE snip + SW round but fills NW + SE corners', () => {
    const path = buildSnipRoundRect({ w: 100, h: 100 });
    const ctx = createTestCanvas(200, 200).getContext('2d');
    expect(ctx.isPointInPath(path, 5, 5)).toBe(true);
    expect(ctx.isPointInPath(path, 95, 95)).toBe(true);
    expect(ctx.isPointInPath(path, 95, 5)).toBe(false);
    expect(ctx.isPointInPath(path, 1, 99)).toBe(false);
  });
});

describe('SNIP_ROUND_RECT_HANDLES', () => {
  it('top + left handles', () => {
    expect(SNIP_ROUND_RECT_HANDLES.length).toBe(2);
  });
});
