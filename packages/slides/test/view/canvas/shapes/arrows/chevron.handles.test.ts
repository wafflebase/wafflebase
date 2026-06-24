import { describe, it, expect } from 'vitest';
import { CHEVRON_HANDLES } from '../../../../../src/view/canvas/shapes/arrows/chevron';

// OOXML: x1 = ss*adj/100000 (back notch), x2 = w - x1 (front point).
// The handle paints at x2. For w=200, h=100: ss=100, x1 = adj/1000.
const FRAME = { w: 200, h: 100 };

describe('CHEVRON_HANDLES', () => {
  it('exposes a single handle', () => {
    expect(CHEVRON_HANDLES).toHaveLength(1);
  });

  describe('position', () => {
    const handle = CHEVRON_HANDLES[0];

    it('default (50000) → handle at x2 = w - 50 = 150', () => {
      const p = handle.position(FRAME, [50000]);
      expect(p.x).toBeCloseTo(150, 5);
      expect(p.y).toBeCloseTo(50, 5);
    });

    it('zero → x1=0 → handle at x2 = w = 200', () => {
      const p = handle.position(FRAME, [0]);
      expect(p).toEqual({ x: 200, y: 50 });
    });

    it('max (100000) → x1=100 → handle at x2 = 100', () => {
      const p = handle.position(FRAME, [100000]);
      expect(p.x).toBeCloseTo(100, 5);
      expect(p.y).toBeCloseTo(50, 5);
    });

    it('out-of-range adj clamps to [0..100000] (matches builder)', () => {
      // adj > max behaves like 100000 (x1 = ss = 100 → x2 = 100).
      expect(handle.position(FRAME, [150000]).x).toBeCloseTo(100, 5);
      // adj < min behaves like 0 (x1 = 0 → x2 = w = 200).
      expect(handle.position(FRAME, [-50000]).x).toBeCloseTo(200, 5);
    });
  });

  describe('apply', () => {
    const handle = CHEVRON_HANDLES[0];

    it('pointer at x2=150 → x1=50 → adj ≈ 50000', () => {
      const next = handle.apply(FRAME, [50000], { x: 150, y: 99 });
      expect(next[0]).toBe(50000);
    });

    it('pointer near the left edge → x1 large → clamps to 100000', () => {
      const next = handle.apply(FRAME, [50000], { x: 25, y: 50 });
      expect(next[0]).toBe(100000);
    });

    it('pointer past the right edge → x1=0 → clamps to 0', () => {
      const next = handle.apply(FRAME, [50000], { x: 250, y: 50 });
      expect(next[0]).toBe(0);
    });

    it('vertical motion is ignored', () => {
      const a = handle.apply(FRAME, [50000], { x: 150, y: 0 });
      const b = handle.apply(FRAME, [50000], { x: 150, y: 100 });
      expect(a).toEqual(b);
    });
  });
});
