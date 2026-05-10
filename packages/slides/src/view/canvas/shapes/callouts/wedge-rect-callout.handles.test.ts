import { describe, it, expect } from 'vitest';
import { WEDGE_RECT_CALLOUT_HANDLES } from './wedge-rect-callout';

const FRAME = { w: 200, h: 100 };
// tx = 100 + (adj0/100000) * 200; ty = 50 + (adj1/100000) * 100

describe('WEDGE_RECT_CALLOUT_HANDLES', () => {
  it('exposes a single handle', () => {
    expect(WEDGE_RECT_CALLOUT_HANDLES).toHaveLength(1);
  });

  describe('position', () => {
    const handle = WEDGE_RECT_CALLOUT_HANDLES[0];

    it('default → tail at (≈58.3, ≈112.5)', () => {
      // adj=[-20833, 62500]: tx = 100 + (-20833/100000)*200 = 58.334
      //                     ty = 50 + (62500/100000)*100 = 112.5
      const p = handle.position(FRAME, [-20833, 62500]);
      expect(p.x).toBeCloseTo(58.334, 2);
      expect(p.y).toBeCloseTo(112.5, 2);
    });

    it('zero adjustment → tail at frame center', () => {
      const p = handle.position(FRAME, [0, 0]);
      expect(p).toEqual({ x: 100, y: 50 });
    });

    it('positive corner adj → tail at far bottom-right', () => {
      const p = handle.position(FRAME, [100000, 100000]);
      expect(p).toEqual({ x: 300, y: 150 });
    });
  });

  describe('apply', () => {
    const handle = WEDGE_RECT_CALLOUT_HANDLES[0];

    it('pointer at frame center → both adj = 0', () => {
      const next = handle.apply(FRAME, [-20833, 62500], { x: 100, y: 50 });
      expect(next).toEqual([0, 0]);
    });

    it('pointer outside max → clamps both to 100000', () => {
      const next = handle.apply(FRAME, [0, 0], { x: 9999, y: 9999 });
      expect(next).toEqual([100000, 100000]);
    });

    it('pointer below min → clamps both to -100000', () => {
      const next = handle.apply(FRAME, [0, 0], { x: -9999, y: -9999 });
      expect(next).toEqual([-100000, -100000]);
    });

    it('round-trip identity inside clamp range', () => {
      const adj = [25000, -40000];
      const p = handle.position(FRAME, adj);
      const back = handle.apply(FRAME, adj, p);
      expect(back[0]).toBeCloseTo(adj[0], -1);
      expect(back[1]).toBeCloseTo(adj[1], -1);
    });
  });
});
