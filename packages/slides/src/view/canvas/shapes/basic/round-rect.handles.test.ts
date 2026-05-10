import { describe, it, expect } from 'vitest';
import { ROUND_RECT_HANDLES } from './round-rect';

const FRAME = { w: 200, h: 100 };

describe('ROUND_RECT_HANDLES', () => {
  it('exposes a single handle', () => {
    expect(ROUND_RECT_HANDLES).toHaveLength(1);
  });

  describe('position', () => {
    const handle = ROUND_RECT_HANDLES[0];

    it('default ratio (16667 thousandths) → r ≈ 16.67% of min(w,h)', () => {
      const p = handle.position(FRAME, [16667]);
      // r = 16667/100000 * min(200,100) = 16.667
      expect(p).toEqual({ x: 16.667, y: 0 });
    });

    it('zero adjustment → handle at top-left corner', () => {
      const p = handle.position(FRAME, [0]);
      expect(p).toEqual({ x: 0, y: 0 });
    });

    it('max adjustment (50000) → handle at half min(w,h) along top edge', () => {
      const p = handle.position(FRAME, [50000]);
      // r = 0.5 * 100 = 50
      expect(p).toEqual({ x: 50, y: 0 });
    });
  });

  describe('apply', () => {
    const handle = ROUND_RECT_HANDLES[0];

    it('pointer at x=25 → adj0 = 25/100 * 100000 = 25000', () => {
      const next = handle.apply(FRAME, [16667], { x: 25, y: 0 });
      expect(next).toEqual([25000]);
    });

    it('pointer past max corner → clamps to 50000', () => {
      const next = handle.apply(FRAME, [16667], { x: 9999, y: 0 });
      expect(next).toEqual([50000]);
    });

    it('negative pointer → clamps to 0', () => {
      const next = handle.apply(FRAME, [16667], { x: -50, y: 0 });
      expect(next).toEqual([0]);
    });

    it('round-trip identity inside clamp range', () => {
      const adj = [25000];
      const p = handle.position(FRAME, adj);
      const back = handle.apply(FRAME, adj, p);
      expect(back[0]).toBeCloseTo(adj[0], -1); // ±50 OOXML units
    });
  });
});
