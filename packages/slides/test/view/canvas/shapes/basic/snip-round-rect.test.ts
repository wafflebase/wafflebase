import { describe, it, expect } from 'vitest';
import '../../../../../src/view/canvas/test-canvas-env';
import { createTestCanvas } from '../../../../../src/view/canvas/test-canvas-env';
import {
  buildSnipRoundRect,
  SNIP_ROUND_RECT_HANDLES,
} from '../../../../../src/view/canvas/shapes/basic/snip-round-rect';

describe('buildSnipRoundRect', () => {
  it('rounds NW + snips NE; bottom corners stay square (OOXML)', () => {
    const path = buildSnipRoundRect({ w: 100, h: 100 });
    const ctx = createTestCanvas(200, 200).getContext('2d');
    expect(ctx.isPointInPath(path, 50, 50)).toBe(true);
    // Bottom corners are square (filled to the corner).
    expect(ctx.isPointInPath(path, 3, 97)).toBe(true);
    expect(ctx.isPointInPath(path, 97, 97)).toBe(true);
    // Top-left rounded, top-right snipped → both corners excluded.
    expect(ctx.isPointInPath(path, 3, 3)).toBe(false);
    expect(ctx.isPointInPath(path, 97, 3)).toBe(false);
  });
});

describe('SNIP_ROUND_RECT_HANDLES', () => {
  it('top + left handles', () => {
    expect(SNIP_ROUND_RECT_HANDLES.length).toBe(2);
  });
});
