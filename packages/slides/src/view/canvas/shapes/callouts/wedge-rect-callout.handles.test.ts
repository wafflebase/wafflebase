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

    it('positive corner adj → tail at far bottom-right (outside frame, no inset)', () => {
      const p = handle.position(FRAME, [100000, 100000]);
      expect(p).toEqual({ x: 300, y: 150 });
    });

    it('tail at NW corner inside the frame → inset 8px away from corner', () => {
      // Land tail at exactly the frame NW corner (tx=0, ty=0). Without
      // the inset guard the diamond would overlap the NW resize handle.
      // adj0 = (0 - w/2)/w * 100000 = -50000; adj1 = same for y.
      const p = handle.position(FRAME, [-50000, -50000]);
      expect(p).toEqual({ x: 8, y: 8 });
    });

    it('tail near SE corner inside the frame → inset toward SE', () => {
      // Land tail at (w-2, h-2) so within HANDLE_INSET of SE corner.
      // adj0 = ((w-2) - w/2)/w * 100000 = (98)/200*100000 = 49000
      // adj1 = ((h-2) - h/2)/h * 100000 = (48)/100*100000 = 48000
      const p = handle.position(FRAME, [49000, 48000]);
      expect(p).toEqual({ x: 192, y: 92 }); // w-INSET, h-INSET
    });

    it('tail outside the frame but near a corner → no inset', () => {
      // tx = -10, ty = -10: outside the frame; the diamond at (-10,-10)
      // is far enough from the (0,0) resize handle (which occupies
      // roughly (-4,-4) to (4,4) in screen px) that no inset is needed
      // and the diamond should stay attached to the actual tail tip.
      // adj0 = (-10 - 100)/200 * 100000 = -55000 (round); adj1 same.
      const p = handle.position(FRAME, [-55000, -60000]);
      expect(p.x).toBeCloseTo(-10, 5);
      expect(p.y).toBeCloseTo(-10, 5);
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
