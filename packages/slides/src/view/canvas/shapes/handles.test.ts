import { describe, it, expect } from 'vitest';
import type { AdjustmentSpec } from './builder';
import { angularHandle, linearTopEdgeHandle } from './handles';

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

const ANGULAR_SPEC: AdjustmentSpec = {
  name: 'Test angle',
  defaultValue: 0,
  min: 0,
  max: 21600000, // 360° in OOXML 60000ths
};

// Pivot at frame centre, radius half the smaller dimension.
const angHandle = angularHandle({
  center: ({ w, h }) => ({ x: w / 2, y: h / 2 }),
  radius: ({ w, h }) => ({ rx: w / 2 - 20, ry: h / 2 - 20 }),
  index: 0,
  spec: ANGULAR_SPEC,
});

describe('angularHandle', () => {
  describe('position', () => {
    it('0° → diamond on the right (positive x axis)', () => {
      const p = angHandle.position({ w: 200, h: 200 }, [0]);
      expect(p.x).toBeCloseTo(180, 6); // cx + rx = 100 + 80
      expect(p.y).toBeCloseTo(100, 6);
    });

    it('90° → diamond on the bottom (screen-down y)', () => {
      const ninety = 90 * 60000;
      const p = angHandle.position({ w: 200, h: 200 }, [ninety]);
      expect(p.x).toBeCloseTo(100, 6);
      expect(p.y).toBeCloseTo(180, 6);
    });

    it('180° → diamond on the left', () => {
      const oneEighty = 180 * 60000;
      const p = angHandle.position({ w: 200, h: 200 }, [oneEighty]);
      expect(p.x).toBeCloseTo(20, 6);
      expect(p.y).toBeCloseTo(100, 6);
    });

    it('270° → diamond on the top', () => {
      const twoSeventy = 270 * 60000;
      const p = angHandle.position({ w: 200, h: 200 }, [twoSeventy]);
      expect(p.x).toBeCloseTo(100, 6);
      expect(p.y).toBeCloseTo(20, 6);
    });

    it('359° → diamond near the right, slightly above', () => {
      const p = angHandle.position({ w: 200, h: 200 }, [359 * 60000]);
      expect(p.x).toBeCloseTo(180, 0);
      expect(p.y).toBeLessThan(100); // just above centre
    });

    it('uses spec default when adjustments[index] is undefined', () => {
      const p = angHandle.position({ w: 200, h: 200 }, []);
      // default 0° → right side
      expect(p.x).toBeCloseTo(180, 6);
      expect(p.y).toBeCloseTo(100, 6);
    });

    it('inset guard pulls the diamond inward at extreme corners', () => {
      // Tight 30×30 frame: radius = (30/2 - 20) = negative; but cos/sin
      // still produce a position. With insetAlongAxis, position should
      // remain within [8, 22] on both axes.
      const p = angHandle.position({ w: 30, h: 30 }, [0]);
      expect(p.x).toBeLessThanOrEqual(22);
      expect(p.x).toBeGreaterThanOrEqual(8);
    });
  });

  describe('apply', () => {
    it('pointer at right edge → 0°', () => {
      const next = angHandle.apply(
        { w: 200, h: 200 },
        [0],
        { x: 200, y: 100 },
      );
      expect(next[0]).toBe(0);
    });

    it('pointer below centre → 90°', () => {
      const next = angHandle.apply(
        { w: 200, h: 200 },
        [0],
        { x: 100, y: 200 },
      );
      expect(next[0]).toBe(90 * 60000);
    });

    it('pointer above centre at start 0° → unwraps to ~−90° then clamps to 0', () => {
      // atan2(-100, 0) = -π/2 → -90°. start = 0 → no unwrap needed.
      // -90° in 60000ths = -5400000. Clamped against [0, 21600000] → 0.
      const next = angHandle.apply(
        { w: 200, h: 200 },
        [0],
        { x: 100, y: 0 },
      );
      expect(next[0]).toBe(0);
    });

    it('crosses 0°/360° boundary without snapping (start 5°, drag to atan2 = -5°)', () => {
      // Pointer at (cx + cos(-5°), cy + sin(-5°)). atan2 returns -5°.
      // Without unwrap → -5° clamps to 0°. With unwrap (start = 5°,
      // delta = -10°, no wrap needed) → -5° remains, clamps to 0°.
      // The test case below explicitly forces a wrap: start near 0 but
      // adjustment range up to 720° (two turns) so unwrap survives.
      const wideSpec: AdjustmentSpec = {
        name: 'Test wide angle',
        defaultValue: 0,
        min: 0,
        max: 720 * 60000,
      };
      const wide = angularHandle({
        center: ({ w, h }) => ({ x: w / 2, y: h / 2 }),
        radius: ({ w, h }) => ({ rx: w / 2, ry: h / 2 }),
        index: 0,
        spec: wideSpec,
      });
      // Start at 355°. Pointer at atan2-= 5° (top-right ish). The
      // unwrap rule lifts 5° → 365° because 365 − 355 = 10° (within
      // 180°) while 5 − 355 = −350° (outside −180°).
      const start = [355 * 60000];
      const next = wide.apply(
        { w: 200, h: 200 },
        start,
        { x: 200, y: 100 + 200 * Math.tan((5 * Math.PI) / 180) / 2 },
      );
      // Should be roughly 365° = 21900000.
      expect(next[0]).toBeGreaterThan(360 * 60000);
      expect(next[0]).toBeLessThan(370 * 60000);
    });

    it('clamps above spec.max', () => {
      // Pointer past 360° in a [0, 90°] spec: clamp to 90°.
      const narrowSpec: AdjustmentSpec = {
        name: 'Narrow',
        defaultValue: 0,
        min: 0,
        max: 90 * 60000,
      };
      const narrow = angularHandle({
        center: ({ w, h }) => ({ x: w / 2, y: h / 2 }),
        radius: ({ w, h }) => ({ rx: w / 2, ry: h / 2 }),
        index: 0,
        spec: narrowSpec,
      });
      // Pointer below centre → atan2 = 90°. Already at spec.max.
      const next = narrow.apply(
        { w: 200, h: 200 },
        [0],
        { x: 100, y: 200 },
      );
      expect(next[0]).toBe(90 * 60000);

      // Pointer at left edge → atan2 = 180°. Should clamp to 90°.
      const past = narrow.apply(
        { w: 200, h: 200 },
        [0],
        { x: 0, y: 100 },
      );
      expect(past[0]).toBe(90 * 60000);
    });

    it('passes through other indices unchanged', () => {
      const twoSpec: AdjustmentSpec = {
        name: 'Two-axis idx=1',
        defaultValue: 0,
        min: 0,
        max: 21600000,
      };
      const second = angularHandle({
        center: ({ w, h }) => ({ x: w / 2, y: h / 2 }),
        radius: ({ w, h }) => ({ rx: w / 2, ry: h / 2 }),
        index: 1,
        spec: twoSpec,
      });
      const next = second.apply(
        { w: 200, h: 200 },
        [12345, 0],
        { x: 200, y: 100 },
      );
      expect(next).toEqual([12345, 0]);
    });

    it('round-trip identity for a non-boundary angle', () => {
      const start = [45 * 60000];
      const p = angHandle.position({ w: 200, h: 200 }, start);
      const back = angHandle.apply({ w: 200, h: 200 }, start, p);
      expect(back[0]).toBeCloseTo(start[0], -3);
    });

    it('does not hang when startAdjustments[index] is non-finite', () => {
      // A corrupt CRDT replica could surface Infinity / NaN. The
      // unwrap loop must terminate; clamping + finite-check should
      // return a clamped result rather than spinning forever.
      const finished = { value: false };
      const timer = setTimeout(() => {
        // If this fires the test is hung — fail fast rather than
        // waiting on the test runner's overall timeout.
        if (!finished.value) {
          throw new Error('angularHandle.apply did not return in 100ms');
        }
      }, 100);
      const next = angHandle.apply(
        { w: 200, h: 200 },
        [Number.POSITIVE_INFINITY],
        { x: 200, y: 100 },
      );
      finished.value = true;
      clearTimeout(timer);
      // Result must be a valid in-range integer, not NaN / Infinity.
      expect(Number.isFinite(next[0])).toBe(true);
      expect(next[0]).toBeGreaterThanOrEqual(ANGULAR_SPEC.min);
      expect(next[0]).toBeLessThanOrEqual(ANGULAR_SPEC.max);
    });
  });
});
