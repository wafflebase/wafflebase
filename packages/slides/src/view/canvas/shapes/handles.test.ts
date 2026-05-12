import { describe, it, expect } from 'vitest';
import type { AdjustmentSpec } from './builder';
import { linearTopEdgeHandle } from './handles';

const SPEC: AdjustmentSpec = {
  name: 'Test',
  defaultValue: 50000,
  min: 0,
  max: 100000,
};

// `triangle`-like forward/inverse — `x = (adj / 100000) * w`.
const handle = linearTopEdgeHandle({
  forward: (adj, { w }) => (adj / 100000) * w,
  inverse: (x, { w }) => (x / w) * 100000,
  spec: SPEC,
});

describe('linearTopEdgeHandle', () => {
  describe('position', () => {
    it('paints on the top edge at the forward mapping', () => {
      const p = handle.position({ w: 200, h: 100 }, [50000]);
      expect(p).toEqual({ x: 100, y: 0 });
    });

    it('zero adjustment → inset 8px from NW corner', () => {
      const p = handle.position({ w: 200, h: 100 }, [0]);
      expect(p).toEqual({ x: 8, y: 0 });
    });

    it('max adjustment → inset 8px from NE corner', () => {
      const p = handle.position({ w: 200, h: 100 }, [100000]);
      expect(p).toEqual({ x: 192, y: 0 });
    });

    it('uses the spec default when adjustments[0] is undefined', () => {
      const p = handle.position({ w: 200, h: 100 }, []);
      // default 50000 → x = 100, inside inset band
      expect(p).toEqual({ x: 100, y: 0 });
    });

    it('tiny frame (w < 2*INSET) → no inset, raw position', () => {
      const p = handle.position({ w: 10, h: 10 }, [0]);
      expect(p).toEqual({ x: 0, y: 0 });
    });
  });

  describe('apply', () => {
    it('inverts pointer.x via the supplied function', () => {
      const next = handle.apply({ w: 200, h: 100 }, [50000], { x: 50, y: 0 });
      expect(next).toEqual([25000]);
    });

    it('clamps to spec.min for pointers past the left boundary', () => {
      const next = handle.apply({ w: 200, h: 100 }, [50000], { x: -50, y: 0 });
      expect(next).toEqual([0]);
    });

    it('clamps to spec.max for pointers past the right boundary', () => {
      const next = handle.apply({ w: 200, h: 100 }, [50000], { x: 9999, y: 0 });
      expect(next).toEqual([100000]);
    });

    it('round-trip identity inside the clamp range', () => {
      const start = [37000];
      const p = handle.position({ w: 200, h: 100 }, start);
      const back = handle.apply({ w: 200, h: 100 }, start, p);
      // ±50 OOXML units (per the contract in builder.ts handle docs)
      expect(back[0]).toBeCloseTo(start[0], -1);
    });
  });
});
