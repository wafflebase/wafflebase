import { describe, it, expect } from 'vitest';
import { CHEVRON_HANDLES } from './chevron';

const FRAME = { w: 200, h: 100 };
// inset formula: (adj/100000) * (h/2) * (w/h)
// For w=200,h=100: inset = (adj/100000) * 50 * 2 = (adj/100000) * 100

describe('CHEVRON_HANDLES', () => {
  it('exposes a single handle', () => {
    expect(CHEVRON_HANDLES).toHaveLength(1);
  });

  describe('position', () => {
    const handle = CHEVRON_HANDLES[0];

    it('default ratio (50000) → handle at (50, 50) for 200x100 frame', () => {
      // inset = 0.5 * 100 = 50
      const p = handle.position(FRAME, [50000]);
      expect(p.x).toBeCloseTo(50, 5);
      expect(p.y).toBeCloseTo(50, 5);
    });

    it('zero ratio → handle at (0, h/2)', () => {
      const p = handle.position(FRAME, [0]);
      expect(p).toEqual({ x: 0, y: 50 });
    });

    it('max ratio → handle at (w-equivalent, h/2)', () => {
      const p = handle.position(FRAME, [100000]);
      expect(p.x).toBeCloseTo(100, 5);
      expect(p.y).toBeCloseTo(50, 5);
    });
  });

  describe('apply', () => {
    const handle = CHEVRON_HANDLES[0];

    it('pointer at x=25, y=anything → adj0 ≈ 25000', () => {
      const next = handle.apply(FRAME, [50000], { x: 25, y: 99 });
      expect(next[0]).toBe(25000);
    });

    it('pointer past max → clamps to 100000', () => {
      const next = handle.apply(FRAME, [50000], { x: 99999, y: 50 });
      expect(next[0]).toBe(100000);
    });

    it('negative pointer → clamps to 0', () => {
      const next = handle.apply(FRAME, [50000], { x: -10, y: 50 });
      expect(next[0]).toBe(0);
    });

    it('vertical motion is ignored', () => {
      const a = handle.apply(FRAME, [50000], { x: 25, y: 0 });
      const b = handle.apply(FRAME, [50000], { x: 25, y: 100 });
      expect(a).toEqual(b);
    });
  });
});
