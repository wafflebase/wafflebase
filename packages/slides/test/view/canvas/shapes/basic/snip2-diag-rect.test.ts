import { describe, it, expect } from 'vitest';
import '../../../../../src/view/canvas/test-canvas-env';
import { createTestCanvas } from '../../../../../src/view/canvas/test-canvas-env';
import {
  buildSnip2DiagRect,
  SNIP2_DIAG_RECT_ADJUSTMENTS,
  SNIP2_DIAG_RECT_HANDLES,
} from '../../../../../src/view/canvas/shapes/basic/snip2-diag-rect';

describe('buildSnip2DiagRect', () => {
  it('OOXML default (adj1=0, adj2=16667) snips only the NE/SW diagonal', () => {
    // adj1 (NW/SE) defaults to 0, so those corners stay square; only
    // the NE/SW diagonal pair (adj2 = 16667) is snipped.
    expect(SNIP2_DIAG_RECT_ADJUSTMENTS[0].defaultValue).toBe(0);
    expect(SNIP2_DIAG_RECT_ADJUSTMENTS[1].defaultValue).toBe(16667);
    const path = buildSnip2DiagRect({ w: 100, h: 100 });
    const ctx = createTestCanvas(200, 200).getContext('2d');
    expect(ctx.isPointInPath(path, 2, 2)).toBe(true); // NW square
    expect(ctx.isPointInPath(path, 98, 98)).toBe(true); // SE square
    expect(ctx.isPointInPath(path, 95, 5)).toBe(false); // NE snipped
    expect(ctx.isPointInPath(path, 5, 95)).toBe(false); // SW snipped
  });

  it('adj1 snips the NW/SE diagonal pair', () => {
    // With adj1 set and adj2 = 0 the snipped diagonal flips.
    const path = buildSnip2DiagRect({ w: 100, h: 100 }, [16667, 0]);
    const ctx = createTestCanvas(200, 200).getContext('2d');
    expect(ctx.isPointInPath(path, 2, 2)).toBe(false); // NW snipped
    expect(ctx.isPointInPath(path, 98, 98)).toBe(false); // SE snipped
    expect(ctx.isPointInPath(path, 95, 5)).toBe(true); // NE square
    expect(ctx.isPointInPath(path, 5, 95)).toBe(true); // SW square
  });
});

describe('SNIP2_DIAG_RECT_HANDLES', () => {
  it('two top-edge handles (NW snip + NE snip on the top edge)', () => {
    expect(SNIP2_DIAG_RECT_HANDLES.length).toBe(2);
    const h0 = SNIP2_DIAG_RECT_HANDLES[0].position({ w: 100, h: 100 }, [16667, 16667]);
    const h1 = SNIP2_DIAG_RECT_HANDLES[1].position({ w: 100, h: 100 }, [16667, 16667]);
    expect(h0.y).toBe(0);
    expect(h1.y).toBe(0);
    // adj1 handle at x = cNwSe; adj2 handle at x = w - cNeSw.
    expect(h0.x).toBeCloseTo(16.667, 1);
    expect(h1.x).toBeCloseTo(83.333, 1);
  });
});
