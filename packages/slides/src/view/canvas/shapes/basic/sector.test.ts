import { describe, it, expect } from 'vitest';
import '../../test-canvas-env';
import { createTestCanvas } from '../../test-canvas-env';
import {
  arcPath,
  blockArcPath,
  chordPath,
  pieSectorPath,
} from './sector';

const FRAME = { w: 100, h: 100 };

// 90° in OOXML 60000ths.
const A_0 = 0;
const A_90 = 90 * 60000;
const A_180 = 180 * 60000;
const A_270 = 270 * 60000;

describe('pieSectorPath', () => {
  it('default 270°→0° produces a wedge containing the NE quadrant', () => {
    const path = pieSectorPath(FRAME, A_270, A_0);
    const ctx = createTestCanvas(200, 200).getContext('2d');
    // Well inside the NE wedge interior (centre is on the boundary,
    // implementation-defined behaviour — skip it).
    expect(ctx.isPointInPath(path, 65, 35)).toBe(true);
    // Opposite quadrant — clearly outside.
    expect(ctx.isPointInPath(path, 30, 70)).toBe(false);
  });

  it('CW sweep direction (0°→90° fills the SE quadrant)', () => {
    const path = pieSectorPath(FRAME, A_0, A_90);
    const ctx = createTestCanvas(200, 200).getContext('2d');
    expect(ctx.isPointInPath(path, 65, 65)).toBe(true);
    expect(ctx.isPointInPath(path, 35, 35)).toBe(false);
  });
});

describe('chordPath', () => {
  it('does NOT include the pivot point', () => {
    // A 90° chord cuts off a thin crescent; the centre is on the
    // chord line, not inside the segment.
    const path = chordPath(FRAME, A_270, A_0);
    const ctx = createTestCanvas(200, 200).getContext('2d');
    // Centre is on the dividing chord — not inside.
    expect(ctx.isPointInPath(path, 50, 50)).toBe(false);
    // NE corner well inside the crescent.
    expect(ctx.isPointInPath(path, 75, 25)).toBe(true);
  });
});

describe('arcPath', () => {
  it('produces a non-null open Path2D', () => {
    // No isPointInStroke in the test canvas shim; geometry is
    // covered by the registry snapshot. Smoke-test that the builder
    // returns an instance.
    const path = arcPath(FRAME, A_270, A_0);
    expect(path).toBeInstanceOf(Path2D);
  });
});

describe('blockArcPath', () => {
  // OOXML angle convention: 0° = right, 90° = bottom (screen y-down),
  // 180° = left, 270° = top. CW sweep from 180° to 0° goes through
  // 270° (top), so the default blockArc is the TOP semi-annulus.

  it('default 180°→0° at 25% thickness includes the outer band on top', () => {
    const path = blockArcPath(FRAME, A_180, A_0, 25000);
    const ctx = createTestCanvas(200, 200).getContext('2d');
    // Top-edge midpoint sits on the outer arc — inside the band.
    expect(ctx.isPointInPath(path, 50, 5)).toBe(true);
    // Centre is inside the inner hole — outside the band.
    expect(ctx.isPointInPath(path, 50, 50)).toBe(false);
  });

  it('full thickness (50000) leaves the band reaching halfway to the centre', () => {
    const path = blockArcPath(FRAME, A_180, A_0, 50000);
    const ctx = createTestCanvas(200, 200).getContext('2d');
    // Outer arc edge still inside.
    expect(ctx.isPointInPath(path, 50, 5)).toBe(true);
    // Just past the inner radius edge (rxy/2 = 25 from centre at
    // top → y ≈ 30). Outside.
    expect(ctx.isPointInPath(path, 50, 30)).toBe(false);
  });
});
