import { describe, it, expect } from 'vitest';
import { CHORD_HANDLES } from './chord';

describe('CHORD_HANDLES', () => {
  it('exposes two angular handles', () => {
    expect(CHORD_HANDLES.length).toBe(2);
  });

  it('handle[1] (end) at 0° → right midpoint', () => {
    const p = CHORD_HANDLES[1].position({ w: 200, h: 200 }, [16200000, 0]);
    expect(p.x).toBeGreaterThan(100);
    expect(p.y).toBeCloseTo(100, 1);
  });
});
