import { describe, it, expect } from 'vitest';
import { PIE_HANDLES } from './pie';

const FRAME = { w: 200, h: 200 };

describe('PIE_HANDLES', () => {
  it('exposes two angular handles', () => {
    expect(PIE_HANDLES.length).toBe(2);
  });

  it('handle[0] paints at the start angle on the ellipse', () => {
    // 270° start → top midpoint.
    const start = [16200000, 0];
    const p = PIE_HANDLES[0].position(FRAME, start);
    expect(p.x).toBeCloseTo(100, 1);
    expect(p.y).toBeLessThan(100);
  });

  it('handle[1] paints at the end angle on the ellipse', () => {
    const start = [16200000, 0];
    const p = PIE_HANDLES[1].position(FRAME, start);
    // 0° end → right midpoint.
    expect(p.x).toBeGreaterThan(100);
    expect(p.y).toBeCloseTo(100, 1);
  });

  it('apply round-trips through index 0 only', () => {
    const start = [16200000, 0];
    const next = PIE_HANDLES[0].apply(FRAME, start, { x: 100, y: 200 });
    // 90° = bottom.
    expect(next[0]).toBe(90 * 60000);
    expect(next[1]).toBe(0);
  });
});
