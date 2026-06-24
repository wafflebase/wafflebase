import { describe, it, expect } from 'vitest';
import { BLOCK_ARC_HANDLES } from '../../../../../src/view/canvas/shapes/basic/block-arc';

const FRAME = { w: 200, h: 200 };

describe('BLOCK_ARC_HANDLES', () => {
  it('exposes three handles (start, end, thickness)', () => {
    expect(BLOCK_ARC_HANDLES.length).toBe(3);
  });

  it('start handle at 180° → left midpoint', () => {
    const p = BLOCK_ARC_HANDLES[0].position(FRAME, [10800000, 0, 25000]);
    expect(p.x).toBeLessThan(100);
    expect(p.y).toBeCloseTo(100, 1);
  });

  it('thickness handle moves toward centre as thickness grows', () => {
    // Default 180°→0° → CW midpoint is 270° = top. Diamond paints
    // on the inner arc at radius (outer - dr), dr = ss*adj3/100000.
    // Growing adj3 enlarges dr, shrinking the inner radius, so the
    // diamond slides from near the top edge down toward the centre.
    const thin = BLOCK_ARC_HANDLES[2].position(FRAME, [10800000, 0, 10000]);
    const thick = BLOCK_ARC_HANDLES[2].position(FRAME, [10800000, 0, 50000]);
    expect(thick.y).toBeGreaterThan(thin.y);
  });

  it('apply on thickness handle writes index 2', () => {
    // Default sweep midpoint is 270° = top → midradial direction is
    // -y. Pointer at (100, 10) is far ALONG that midradial (close
    // to outer arc, near the top edge) → projection / outerR ≈ 0.9
    // → thinFrac ≈ 0.9 → thickness ≈ 10000.
    const thin = BLOCK_ARC_HANDLES[2].apply(
      FRAME,
      [10800000, 0, 25000],
      { x: 100, y: 10 },
    );
    expect(thin[0]).toBe(10800000);
    expect(thin[1]).toBe(0);
    expect(thin[2]).toBeLessThan(25000);

    // Pointer near the centre along the same midradial → high
    // thickness (clamps to spec.max = 50000).
    const thick = BLOCK_ARC_HANDLES[2].apply(
      FRAME,
      [10800000, 0, 25000],
      { x: 100, y: 95 },
    );
    expect(thick[2]).toBeGreaterThan(25000);
  });

  it('thickness handle round-trips on a non-square frame (diagonal mid)', () => {
    // 400×200 frame, sweep 0°→90° → midradial at 45° (diagonal), so the
    // true ellipse radius differs from the per-axis offset. Painting the
    // diamond for adj3, then applying it back from that exact point, must
    // recover the same adj3 (regression for the rx≠ry inverse drift).
    const wide = { w: 400, h: 200 };
    for (const adj3 of [10000, 25000, 40000]) {
      const start = [0, 5400000, adj3];
      const p = BLOCK_ARC_HANDLES[2].position(wide, start);
      const out = BLOCK_ARC_HANDLES[2].apply(wide, start, p);
      // insetAlongAxis can nudge the painted point a few px off the true
      // inner arc near the frame edges; allow a small tolerance.
      expect(out[2]).toBeGreaterThan(adj3 - 1500);
      expect(out[2]).toBeLessThan(adj3 + 1500);
    }
  });
});
