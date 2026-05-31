import { describe, expect, it } from 'vitest';
import {
  isBezierPath,
  routeCurved,
  routeElbow,
  routeStraight,
} from '../../../src/view/canvas/routing';
import {
  DIR_E,
  DIR_N,
  DIR_S,
  DIR_W,
} from '../../../src/model/connection-site';

describe('routeStraight', () => {
  it('produces a 2-point segment from a to b', () => {
    const p = routeStraight({ x: 0, y: 0 }, { x: 100, y: 50 });
    expect(p.points).toEqual([
      { x: 0, y: 0 },
      { x: 100, y: 50 },
    ]);
  });

  it('handles zero-length (coincident endpoints)', () => {
    const p = routeStraight({ x: 5, y: 5 }, { x: 5, y: 5 });
    expect(p.points).toEqual([
      { x: 5, y: 5 },
      { x: 5, y: 5 },
    ]);
  });
});

describe('routeCurved', () => {
  it('returns a cubic bezier with control points along the exit directions', () => {
    // dist = 300 → k = 100.
    const path = routeCurved(
      { x: 0, y: 0 }, DIR_E,
      { x: 300, y: 0 }, DIR_W,
    );
    expect(path.p0).toEqual({ x: 0, y: 0 });
    expect(path.p1).toEqual({ x: 300, y: 0 });
    expect(path.c1.x).toBeCloseTo(100);
    expect(path.c1.y).toBeCloseTo(0);
    expect(path.c2.x).toBeCloseTo(200);
    expect(path.c2.y).toBeCloseTo(0);
  });

  it('pulls the curve perpendicular to the chord when exits are perpendicular', () => {
    // a at origin exiting east; b at (200, 200) exiting south (path arrives
    // from the north). dist = ~282.84, k ≈ 94.28.
    const path = routeCurved(
      { x: 0, y: 0 }, DIR_E,
      { x: 200, y: 200 }, DIR_S,
    );
    expect(path.c1.x).toBeCloseTo(94.28, 1);
    expect(path.c1.y).toBeCloseTo(0, 1);
    expect(path.c2.x).toBeCloseTo(200, 1);
    expect(path.c2.y).toBeCloseTo(294.28, 1);
  });

  it('degenerates to a zero-length bezier when endpoints coincide', () => {
    const path = routeCurved(
      { x: 7, y: 11 }, DIR_E,
      { x: 7, y: 11 }, DIR_W,
    );
    // dist = 0 → k = 0 → control points equal the endpoints.
    expect(path.c1).toEqual({ x: 7, y: 11 });
    expect(path.c2).toEqual({ x: 7, y: 11 });
  });

  it('isBezierPath narrows the union', () => {
    const seg = routeStraight({ x: 0, y: 0 }, { x: 1, y: 0 });
    const bez = routeCurved({ x: 0, y: 0 }, DIR_E, { x: 1, y: 0 }, DIR_W);
    expect(isBezierPath(seg)).toBe(false);
    expect(isBezierPath(bez)).toBe(true);
  });
});

describe('routeElbow', () => {
  it('perpendicular exits (E + S) — 1-bend L through (b.x, a.y)', () => {
    const path = routeElbow(
      { x: 0, y: 0 }, DIR_E,
      { x: 200, y: 150 }, DIR_S,
    );
    expect(path.points).toEqual([
      { x: 0, y: 0 },
      { x: 200, y: 0 },
      { x: 200, y: 150 },
    ]);
  });

  it('perpendicular exits (S + E) — 1-bend L through (a.x, b.y)', () => {
    // a exits south (down), b exits east → corner at (a.x, b.y).
    const path = routeElbow(
      { x: 50, y: 0 }, DIR_S,
      { x: 250, y: 100 }, DIR_E,
    );
    expect(path.points).toEqual([
      { x: 50, y: 0 },
      { x: 50, y: 100 },
      { x: 250, y: 100 },
    ]);
  });

  it('parallel-opposite facing each other (E + W) — 2-bend Z, mid-x at midpoint', () => {
    const path = routeElbow(
      { x: 0, y: 0 }, DIR_E,
      { x: 200, y: 100 }, DIR_W,
    );
    // Midpoint along parallel axis = (0+200)/2 = 100.
    expect(path.points).toEqual([
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 200, y: 100 },
    ]);
  });

  it('parallel-opposite facing each other (N + S) — vertical Z', () => {
    // a exits north (up = -y), b exits south (down = +y); a is below b
    // visually means the exits do face each other when a.y > b.y. Midpoint
    // along the parallel axis = average y.
    const path = routeElbow(
      { x: 0, y: 200 }, DIR_N,
      { x: 100, y: 0 }, DIR_S,
    );
    expect(path.points).toEqual([
      { x: 0, y: 200 },
      { x: 0, y: 100 },
      { x: 100, y: 100 },
      { x: 100, y: 0 },
    ]);
  });

  it('parallel-opposite facing away (E + W with a east of b) — 3-bend U', () => {
    // a at (300, 0) exits east; b at (0, 100) exits west. Both face away
    // from the line connecting them; the path must loop out past each
    // endpoint and arrive at b moving east (opposite of bDir = W).
    const path = routeElbow(
      { x: 300, y: 0 }, DIR_E,
      { x: 0, y: 100 }, DIR_W,
    );
    expect(path.points).toHaveLength(5);
    expect(path.points[0]).toEqual({ x: 300, y: 0 });
    expect(path.points[4]).toEqual({ x: 0, y: 100 });
    const aLoop = path.points[1].x;
    const bLoop = path.points[3].x;
    expect(aLoop).toBeGreaterThan(300);
    expect(bLoop).toBeLessThan(0);
    // Cross-leg sits at b.y so the final segment runs east along y=100 into b.
    expect(path.points[1]).toEqual({ x: aLoop, y: 0 });
    expect(path.points[2]).toEqual({ x: aLoop, y: 100 });
    expect(path.points[3]).toEqual({ x: bLoop, y: 100 });
  });

  it('parallel-same (E + E) — 2-bend C past the further-east endpoint', () => {
    // Both exits east: leave a east, loop past max(a.x, b.x), come back
    // west into b (matching b's exit east → arrival west).
    const path = routeElbow(
      { x: 0, y: 0 }, DIR_E,
      { x: 100, y: 60 }, DIR_E,
    );
    expect(path.points).toHaveLength(4);
    expect(path.points[0]).toEqual({ x: 0, y: 0 });
    expect(path.points[3]).toEqual({ x: 100, y: 60 });
    const loopX = path.points[1].x;
    expect(loopX).toBeGreaterThan(100);
    expect(path.points[1]).toEqual({ x: loopX, y: 0 });
    expect(path.points[2]).toEqual({ x: loopX, y: 60 });
  });

  it('parallel-same (S + S) — vertical C past the further-south endpoint', () => {
    const path = routeElbow(
      { x: 0, y: 0 }, DIR_S,
      { x: 100, y: 80 }, DIR_S,
    );
    expect(path.points).toHaveLength(4);
    expect(path.points[0]).toEqual({ x: 0, y: 0 });
    expect(path.points[3]).toEqual({ x: 100, y: 80 });
    const loopY = path.points[1].y;
    expect(loopY).toBeGreaterThan(80);
    expect(path.points[1]).toEqual({ x: 0, y: loopY });
    expect(path.points[2]).toEqual({ x: 100, y: loopY });
  });

  it('honours the bend parameter on the parallel-opposite Z case', () => {
    // Default bend = 0.5 → mid x = 100. bend = 0.25 → mid x = 50.
    const path = routeElbow(
      { x: 0, y: 0 }, DIR_E,
      { x: 200, y: 100 }, DIR_W,
      0.25,
    );
    expect(path.points[1].x).toBeCloseTo(50);
    expect(path.points[2].x).toBeCloseTo(50);
  });

  it('clamps extreme bend values into a visible range', () => {
    // bend = 2 (out of range) clamps to 0.95 → mid x = 190.
    const path = routeElbow(
      { x: 0, y: 0 }, DIR_E,
      { x: 200, y: 100 }, DIR_W,
      2,
    );
    expect(path.points[1].x).toBeCloseTo(190);
  });

  it('snaps non-cardinal exit angles to the nearest cardinal', () => {
    // Angle slightly off east still routes as perpendicular L through
    // (b.x, a.y).
    const path = routeElbow(
      { x: 0, y: 0 }, 0.2,
      { x: 200, y: 150 }, Math.PI / 2 - 0.2,
    );
    expect(path.points).toEqual([
      { x: 0, y: 0 },
      { x: 200, y: 0 },
      { x: 200, y: 150 },
    ]);
  });
});
