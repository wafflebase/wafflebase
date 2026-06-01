import { describe, it, expect } from 'vitest';
import '../../../../../src/view/canvas/test-canvas-env';
import { createTestCanvas } from '../../../../../src/view/canvas/test-canvas-env';
import {
  buildNoSmoking,
  NO_SMOKING_ADJUSTMENTS,
  NO_SMOKING_HANDLES,
} from '../../../../../src/view/canvas/shapes/basic/no-smoking';

// `noSmoking` is rendered with the even-odd fill rule (see
// `shape-renderer.EVENODD_KINDS`), so hit-tests use 'evenodd' to mirror
// the production fill semantics.
//
// Frame is 100 × 100 at default adj 18750: t = 18.75, irx = iry = 31.25,
// band half-thickness ht = t/2 = 9.375. Centre (50, 50). Slash direction
// is the NW→SE diagonal, so signed perpendicular distance at (px, py)
// from the centreline equals 0.7071 * (py − px).

describe('buildNoSmoking', () => {
  it('fills the ring annulus', () => {
    const path = buildNoSmoking({ w: 100, h: 100 });
    const ctx = createTestCanvas(200, 200).getContext('2d');
    // Top of the ring — distance 48 from centre, between irx (31.25)
    // and rx (50).
    expect(ctx.isPointInPath(path, 50, 2, 'evenodd')).toBe(true);
  });

  it('fills the slash where it crosses the central hole', () => {
    const path = buildNoSmoking({ w: 100, h: 100 });
    const ctx = createTestCanvas(200, 200).getContext('2d');
    // Slash centreline inside the inner ellipse — band fills the hole.
    expect(ctx.isPointInPath(path, 50, 50, 'evenodd')).toBe(true);
    // Off-centre point on the slash centreline, still inside the inner
    // ellipse.
    expect(ctx.isPointInPath(path, 40, 40, 'evenodd')).toBe(true);
  });

  it('leaves the NE inner hole unfilled', () => {
    const path = buildNoSmoking({ w: 100, h: 100 });
    const ctx = createTestCanvas(200, 200).getContext('2d');
    // (45, 25): signed_perp ≈ −14.14 (NE of the band), distance 25.5
    // from centre (well inside the inner ellipse). This point sat
    // inside the previous V0's thick slash band, so confirming it is
    // *not* filled now guards against the union-outline regression.
    expect(ctx.isPointInPath(path, 45, 25, 'evenodd')).toBe(false);
  });

  it('leaves the SW inner hole unfilled', () => {
    const path = buildNoSmoking({ w: 100, h: 100 });
    const ctx = createTestCanvas(200, 200).getContext('2d');
    // (25, 45): mirror of the NE point across the slash centreline.
    expect(ctx.isPointInPath(path, 25, 45, 'evenodd')).toBe(false);
  });

  it('clips the slash to the outer ellipse', () => {
    const path = buildNoSmoking({ w: 100, h: 100 });
    const ctx = createTestCanvas(200, 200).getContext('2d');
    // (95, 95): on the slash centreline but well outside the outer
    // ellipse (distance ≈ 63.6 > rx = 50). The previous V0's slash
    // polygon extended past the corner to (~113, ~87); the union
    // outline must not paint anything outside the outer ellipse.
    expect(ctx.isPointInPath(path, 95, 95, 'evenodd')).toBe(false);
  });

  it('default thickness is 18750', () => {
    expect(NO_SMOKING_ADJUSTMENTS[0].defaultValue).toBe(18750);
  });

  it('collapses to a solid disc when adj fills the inner ellipse', () => {
    // adj = 50000 → innerScale = 0, irx = iry = 0. Only the outer
    // ellipse paints; no holes are carved.
    const path = buildNoSmoking({ w: 100, h: 100 }, [50000]);
    const ctx = createTestCanvas(200, 200).getContext('2d');
    expect(ctx.isPointInPath(path, 50, 50, 'evenodd')).toBe(true);
    expect(ctx.isPointInPath(path, 50, 2, 'evenodd')).toBe(true);
  });
});

describe('NO_SMOKING_HANDLES', () => {
  it('exposes one handle on the top edge', () => {
    expect(NO_SMOKING_HANDLES.length).toBe(1);
  });
});
