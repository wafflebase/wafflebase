import { describe, it, expect } from 'vitest';
import '../../test-canvas-env';
import { createTestCanvas } from '../../test-canvas-env';
import {
  buildSnip2DiagRect,
  SNIP2_DIAG_RECT_HANDLES,
} from './snip2-diag-rect';

describe('buildSnip2DiagRect', () => {
  it('excludes NE and SW corners but fills NW and SE', () => {
    const path = buildSnip2DiagRect({ w: 100, h: 100 });
    const ctx = createTestCanvas(200, 200).getContext('2d');
    expect(ctx.isPointInPath(path, 5, 5)).toBe(true); // NW
    expect(ctx.isPointInPath(path, 95, 95)).toBe(true); // SE
    expect(ctx.isPointInPath(path, 95, 5)).toBe(false); // NE chamfered
    expect(ctx.isPointInPath(path, 5, 95)).toBe(false); // SW chamfered
  });
});

describe('SNIP2_DIAG_RECT_HANDLES', () => {
  it('top + left edges', () => {
    expect(SNIP2_DIAG_RECT_HANDLES.length).toBe(2);
    expect(SNIP2_DIAG_RECT_HANDLES[0].position({ w: 100, h: 100 }, [12500, 12500]).y).toBe(0);
    expect(SNIP2_DIAG_RECT_HANDLES[1].position({ w: 100, h: 100 }, [12500, 12500]).x).toBe(0);
  });
});
