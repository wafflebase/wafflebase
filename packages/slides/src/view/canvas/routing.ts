export type Point = { x: number; y: number };
export type SegmentPath = { points: Point[] };
export type BezierPath = { p0: Point; c1: Point; c2: Point; p1: Point };
export type ConnectorPath = SegmentPath | BezierPath;

export function isBezierPath(path: ConnectorPath): path is BezierPath {
  return (path as BezierPath).p0 !== undefined;
}

export function routeStraight(a: Point, b: Point): SegmentPath {
  return { points: [{ ...a }, { ...b }] };
}

/**
 * Cubic bezier connector. Control points sit `dist/3` along each exit
 * direction so the curve leaves both endpoints tangent to their outward
 * normals. Matches PowerPoint's `curvedConnector*` look.
 */
export function routeCurved(
  a: Point,
  aDir: number,
  b: Point,
  bDir: number,
): BezierPath {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const k = Math.hypot(dx, dy) / 3;
  return {
    p0: { ...a },
    c1: { x: a.x + Math.cos(aDir) * k, y: a.y + Math.sin(aDir) * k },
    c2: { x: b.x + Math.cos(bDir) * k, y: b.y + Math.sin(bDir) * k },
    p1: { ...b },
  };
}

type Axis = 'h' | 'v';
type CardinalSign = -1 | 1;
type Cardinal = { axis: Axis; sign: CardinalSign };

const TWO_PI = Math.PI * 2;
const QUARTER_PI = Math.PI / 4;
const ELBOW_LOOP_MARGIN = 24;

function toCardinal(angle: number): Cardinal {
  const norm = ((angle % TWO_PI) + TWO_PI) % TWO_PI;
  // Boundaries (exact π/4, 3π/4, 5π/4, 7π/4) bias clockwise — e.g. π/4
  // snaps to South, not East. A snap function has to pick a side at the
  // boundary; the bias is arbitrary but consistent.
  if (norm < QUARTER_PI || norm >= 7 * QUARTER_PI) {
    return { axis: 'h', sign: 1 }; // East
  }
  if (norm < 3 * QUARTER_PI) return { axis: 'v', sign: 1 }; // South
  if (norm < 5 * QUARTER_PI) return { axis: 'h', sign: -1 }; // West
  return { axis: 'v', sign: -1 }; // North
}

/**
 * Manhattan-routed connector. Exit angles are snapped to the nearest
 * cardinal, then the segment topology is chosen from the direction pair:
 *
 * - Perpendicular axes → 1-bend L.
 * - Parallel-opposite, facing each other → 2-bend Z with the cross-leg
 *   at the parallel-axis midpoint (or at `bend` ratio when supplied).
 * - Parallel-opposite, facing away → 3-bend U looping past each
 *   endpoint.
 * - Parallel-same → 3-bend U-turn looping `ELBOW_LOOP_MARGIN` past the
 *   further endpoint along the shared exit direction.
 *
 * `bend` (when defined and in (0, 1)) overrides the default cross-leg
 * ratio along the parallel axis for the Z case. Free endpoints default
 * to 0.5; the user-adjustable yellow-diamond handle writes a stored
 * value into the connector to persist a manual position.
 *
 * Returns a polyline; consecutive identical points are preserved so
 * `points.length` reflects the topology and the renderer can stroke it
 * with plain `lineTo` calls.
 */
export function routeElbow(
  a: Point,
  aDir: number,
  b: Point,
  bDir: number,
  bend?: number,
): SegmentPath {
  const ac = toCardinal(aDir);
  const bc = toCardinal(bDir);

  if (ac.axis !== bc.axis) {
    // Perpendicular L. Corner along a's exit axis, then b's exit axis.
    const corner: Point =
      ac.axis === 'h' ? { x: b.x, y: a.y } : { x: a.x, y: b.y };
    return { points: [{ ...a }, corner, { ...b }] };
  }

  // Parallel — same axis. Helpers reading along the parallel and the
  // perpendicular components keep the two-axis code symmetric.
  const par = ac.axis === 'h' ? 'x' : 'y';
  const perp = ac.axis === 'h' ? 'y' : 'x';
  const aPar = a[par];
  const bPar = b[par];
  const aPerp = a[perp];
  const bPerp = b[perp];

  if (ac.sign !== bc.sign) {
    // Parallel-opposite. "Facing each other" means each exit points toward
    // the other endpoint along the parallel axis.
    const facing =
      (ac.sign === 1 && aPar <= bPar) || (ac.sign === -1 && aPar >= bPar);
    if (facing) {
      // 2-bend Z, mid-cross at `bend` ratio (default 0.5) along the
      // parallel axis between the two endpoints. Clamped to (0, 1) so a
      // stored extreme can't degenerate the Z into a single segment.
      const ratio = clampBend(bend);
      const mid = aPar + (bPar - aPar) * ratio;
      const p1 = makePoint(par, mid, perp, aPerp);
      const p2 = makePoint(par, mid, perp, bPerp);
      return { points: [{ ...a }, p1, p2, { ...b }] };
    }
    // 3-bend U. Each end loops out past its own exit; the cross-leg sits
    // at b's perpendicular value so the final segment into b stays axis-
    // aligned along the parallel axis. Asymmetric but compact (5 points).
    const aLoop = aPar + ac.sign * ELBOW_LOOP_MARGIN;
    const bLoop = bPar + bc.sign * ELBOW_LOOP_MARGIN;
    const p1 = makePoint(par, aLoop, perp, aPerp);
    const p2 = makePoint(par, aLoop, perp, bPerp);
    const p3 = makePoint(par, bLoop, perp, bPerp);
    return {
      points: [{ ...a }, p1, p2, p3, { ...b }],
    };
  }

  // Parallel-same. Both exits point the same way → C-shape with the
  // cross-leg at the loop past the further-along endpoint.
  const loop =
    ac.sign === 1
      ? Math.max(aPar, bPar) + ELBOW_LOOP_MARGIN
      : Math.min(aPar, bPar) - ELBOW_LOOP_MARGIN;
  const p1 = makePoint(par, loop, perp, aPerp);
  const p2 = makePoint(par, loop, perp, bPerp);
  return { points: [{ ...a }, p1, p2, { ...b }] };
}

function makePoint(
  parKey: 'x' | 'y',
  parVal: number,
  perpKey: 'x' | 'y',
  perpVal: number,
): Point {
  const p: Point = { x: 0, y: 0 };
  p[parKey] = parVal;
  p[perpKey] = perpVal;
  return p;
}

/** Default 0.5; clamped to (0.05, 0.95) so the Z stays visibly bent. */
function clampBend(bend: number | undefined): number {
  if (bend === undefined || !Number.isFinite(bend)) return 0.5;
  return Math.min(0.95, Math.max(0.05, bend));
}
