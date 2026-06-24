import { describe, it, expect } from 'vitest';
import '../../../../../src/view/canvas/test-canvas-env';
import { createTestCanvas } from '../../../../../src/view/canvas/test-canvas-env';
import {
  buildSnip2SameRect,
  SNIP2_SAME_RECT_ADJUSTMENTS,
  SNIP2_SAME_RECT_HANDLES,
} from '../../../../../src/view/canvas/shapes/basic/snip2-same-rect';

describe('buildSnip2SameRect', () => {
  it('OOXML default (adj1=16667, adj2=0) snips only the TOP corners', () => {
    expect(SNIP2_SAME_RECT_ADJUSTMENTS[0].defaultValue).toBe(16667);
    expect(SNIP2_SAME_RECT_ADJUSTMENTS[1].defaultValue).toBe(0);
    const path = buildSnip2SameRect({ w: 100, h: 100 });
    const ctx = createTestCanvas(200, 200).getContext('2d');
    expect(ctx.isPointInPath(path, 50, 50)).toBe(true);
    expect(ctx.isPointInPath(path, 5, 5)).toBe(false); // NW snipped
    expect(ctx.isPointInPath(path, 95, 5)).toBe(false); // NE snipped
    expect(ctx.isPointInPath(path, 2, 98)).toBe(true); // SW square
    expect(ctx.isPointInPath(path, 98, 98)).toBe(true); // SE square
  });

  it('adj2 snips the BOTTOM corners', () => {
    const path = buildSnip2SameRect({ w: 100, h: 100 }, [0, 16667]);
    const ctx = createTestCanvas(200, 200).getContext('2d');
    expect(ctx.isPointInPath(path, 2, 2)).toBe(true); // NW square
    expect(ctx.isPointInPath(path, 98, 2)).toBe(true); // NE square
    expect(ctx.isPointInPath(path, 5, 95)).toBe(false); // SW snipped
    expect(ctx.isPointInPath(path, 95, 95)).toBe(false); // SE snipped
  });
});

describe('SNIP2_SAME_RECT_HANDLES', () => {
  it('exposes a top-edge handle (adj1) and a bottom-edge handle (adj2)', () => {
    expect(SNIP2_SAME_RECT_HANDLES.length).toBe(2);
    const top = SNIP2_SAME_RECT_HANDLES[0].position({ w: 100, h: 100 }, [16667, 16667]);
    const bot = SNIP2_SAME_RECT_HANDLES[1].position({ w: 100, h: 100 }, [16667, 16667]);
    expect(top.y).toBe(0);
    expect(bot.y).toBe(100);
  });
});
