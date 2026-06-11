import type { ConnectorElement } from '../../model/connector';
import type { Element } from '../../model/element';
import {
  buildConnectorPath,
  resolveEndpoint,
  resolveEndpointWithDir,
} from './connector-frame';
import {
  CURVE_BEND_MAX,
  CURVE_BEND_MIN,
  type BezierPath,
  type Point,
  isBezierPath,
} from './routing';

/**
 * World-space position of the yellow-diamond bend handle for a
 * selected connector, or `null` when the connector's routing /
 * topology has no adjustable bend.
 *
 * Elbow: only the 2-bend Z topology (parallel-opposite-facing exits)
 * exposes a bend handle in v1 — the cross-leg midpoint between the
 * two interior points. L (1-bend), U (3-bend opposite), and C (3-bend
 * same) currently have no routing parameter to drive, so the handle
 * is suppressed there.
 *
 * Curved: always the bezier midpoint (t=0.5).
 */
export function bendHandlePosition(
  connector: ConnectorElement,
  elements: ReadonlyMap<string, Element>,
): Point | null {
  if (connector.routing === 'straight') return null;
  const path = buildConnectorPath(connector, elements);
  if (isBezierPath(path)) {
    return bezierAt(path, 0.5);
  }
  // SegmentPath. The Z topology is exactly 4 points: [a, p1, p2, b];
  // its cross-leg midpoint is (p1 + p2) / 2.
  if (path.points.length !== 4) return null;
  const [, p1, p2] = path.points;
  return { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
}

/**
 * Convert a cursor world position into a bend value for the connector.
 * Returns `null` for routings / topologies without an adjustable bend
 * (mirrors `bendHandlePosition`).
 *
 * Elbow Z: project the cursor onto the parallel axis between the two
 * endpoints, return the [0, 1] ratio (clamped to (0.05, 0.95) so the
 * stored value can't collapse the Z into a single segment — matches
 * the clamp inside `routeElbow`).
 *
 * Curved: solve for the bend factor that places the bezier's
 * midpoint at the cursor's perpendicular distance from the chord.
 * Clamped to `[CURVE_BEND_MIN, CURVE_BEND_MAX]` so the handle never
 * drives the routing through a degenerate state.
 */
export function bendFromCursor(
  connector: ConnectorElement,
  cursor: Point,
  elements: ReadonlyMap<string, Element>,
): number | null {
  if (connector.routing === 'straight') return null;

  const aPos = resolveEndpoint(connector.start, elements);
  const bPos = resolveEndpoint(connector.end, elements);

  if (connector.routing === 'elbow') {
    // Determine the parallel axis from the Z topology of the rendered
    // path. Anything other than 4 points is L / U / C / degenerate —
    // no bend to compute.
    const path = buildConnectorPath(connector, elements);
    if (isBezierPath(path) || path.points.length !== 4) return null;
    const [, p1, p2] = path.points;
    // Parallel axis is the one shared between p1 and p2.
    const par: 'x' | 'y' =
      Math.abs(p1.x - p2.x) < Math.abs(p1.y - p2.y) ? 'x' : 'y';
    const aPar = aPos[par];
    const bPar = bPos[par];
    if (Math.abs(bPar - aPar) < 1e-6) return 0.5;
    const ratio = (cursor[par] - aPar) / (bPar - aPar);
    return Math.min(0.95, Math.max(0.05, ratio));
  }

  // Curved.
  const a = resolveEndpointWithDir(connector.start, elements, bPos);
  const b = resolveEndpointWithDir(connector.end, elements, aPos);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dist = Math.hypot(dx, dy);
  if (dist < 1e-6) return CURVE_BEND_MIN;
  // Chord-perpendicular unit vector. Signed projection of cursor → midpoint
  // perpendicular displacement. `perpHat = (-dy, dx) / dist`.
  const perpHat = { x: -dy / dist, y: dx / dist };
  const midOfChord = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const cdx = cursor.x - midOfChord.x;
  const cdy = cursor.y - midOfChord.y;
  const cursorPerp = cdx * perpHat.x + cdy * perpHat.y;
  // At t=0.5, B(0.5) = 0.125*p0 + 0.375*c1 + 0.375*c2 + 0.125*p1, so the
  // perpendicular component of B(0.5) relative to the chord equals
  // 0.375 * k * (sin α + sin β), where α, β are the exit angles
  // relative to the chord. Solve for k:
  const chordAngle = Math.atan2(dy, dx);
  const sinSum =
    Math.sin(a.angle - chordAngle) + Math.sin(b.angle - chordAngle);
  if (Math.abs(sinSum) < 1e-3) {
    // Both exits parallel to (or symmetric against) the chord: there's
    // no analytic perpendicular control; just match the cursor distance
    // with bend = |cursorPerp| * 3 / dist as a graceful fallback.
    return Math.min(
      CURVE_BEND_MAX,
      Math.max(CURVE_BEND_MIN, (Math.abs(cursorPerp) * 3) / dist),
    );
  }
  // 0.375 * k * sinSum = cursorPerp  ⇒  k = cursorPerp / (0.375 * sinSum)
  // bend = k / (dist / 3) = cursorPerp * 8 / (dist * sinSum)
  const bend = (cursorPerp * 8) / (dist * sinSum);
  return Math.min(CURVE_BEND_MAX, Math.max(CURVE_BEND_MIN, bend));
}

function bezierAt(b: BezierPath, t: number): Point {
  const u = 1 - t;
  const u2 = u * u;
  const t2 = t * t;
  return {
    x:
      u2 * u * b.p0.x +
      3 * u2 * t * b.c1.x +
      3 * u * t2 * b.c2.x +
      t2 * t * b.p1.x,
    y:
      u2 * u * b.p0.y +
      3 * u2 * t * b.c1.y +
      3 * u * t2 * b.c2.y +
      t2 * t * b.p1.y,
  };
}
