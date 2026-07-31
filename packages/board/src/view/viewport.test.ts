import { describe, it, expect } from 'vitest';
import { zoomAt, panBy, DEFAULT_VIEWPORT, screenToWorld } from './viewport';

describe('board viewport ops', () => {
  it('zoomAt keeps the anchored world point stationary', () => {
    const v = DEFAULT_VIEWPORT;
    const anchor = { x: 300, y: 200 };
    const before = screenToWorld(v, anchor);
    const z = zoomAt(v, anchor, 2);
    const after = screenToWorld(z, anchor);
    expect(z.zoom).toBe(2);
    expect(after.x).toBeCloseTo(before.x, 10);
    expect(after.y).toBeCloseTo(before.y, 10);
  });
  it('zoomAt clamps to [min,max]', () => {
    expect(zoomAt(DEFAULT_VIEWPORT, { x: 0, y: 0 }, 100, 0.1, 8).zoom).toBe(8);
    expect(zoomAt({ panX: 0, panY: 0, zoom: 1 }, { x: 0, y: 0 }, 0.001, 0.1, 8).zoom).toBe(0.1);
  });
  it('panBy shifts pan by screen delta', () => {
    expect(panBy(DEFAULT_VIEWPORT, 15, -5)).toEqual({ panX: 15, panY: -5, zoom: 1 });
  });
});
