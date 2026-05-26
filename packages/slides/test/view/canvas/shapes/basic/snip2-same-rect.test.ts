import { describe, it, expect } from 'vitest';
import '../../../../../src/view/canvas/test-canvas-env';
import { createTestCanvas } from '../../../../../src/view/canvas/test-canvas-env';
import {
  buildSnip2SameRect,
  SNIP2_SAME_RECT_HANDLES,
} from '../../../../../src/view/canvas/shapes/basic/snip2-same-rect';

describe('buildSnip2SameRect', () => {
  it('fills centre, excludes both top corners', () => {
    const path = buildSnip2SameRect({ w: 100, h: 100 });
    const ctx = createTestCanvas(200, 200).getContext('2d');
    expect(ctx.isPointInPath(path, 50, 50)).toBe(true);
    expect(ctx.isPointInPath(path, 5, 5)).toBe(false);
    expect(ctx.isPointInPath(path, 95, 5)).toBe(false);
  });
});

describe('SNIP2_SAME_RECT_HANDLES', () => {
  it('exposes two top-edge handles', () => {
    expect(SNIP2_SAME_RECT_HANDLES.length).toBe(2);
  });
});
