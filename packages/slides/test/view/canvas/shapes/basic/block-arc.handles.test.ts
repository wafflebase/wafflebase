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
});
