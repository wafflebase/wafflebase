import type { PathBuilder } from '../builder';

/**
 * `cloud` — single connected cloud silhouette.
 *
 * The previous implementation drew N separate full-circle `arc()` calls
 * which painted N circle outlines plus implicit `lineTo` segments between
 * arc start points (visible as polygon-edge connectors). The result read
 * as "circles glued together with a polygon", not a cloud.
 *
 * The current implementation uses N=6 overlapping lobes arranged around
 * the cloud centre. For each adjacent pair of lobes we compute the two
 * circle-circle intersection points and pick the OUTER one (farther from
 * the cloud centre). Each lobe then contributes a single arc bulging
 * outward, from "intersection with previous lobe" to "intersection with
 * next lobe". Because consecutive arcs share an endpoint, the path is a
 * single continuous closed silhouette with no internal cross-lines and
 * no polygon connectors.
 */

interface Lobe {
  x: number;
  y: number;
  r: number;
}

interface Point {
  x: number;
  y: number;
}

/**
 * Two intersection points of two overlapping circles. Returns null if
 * the circles are disjoint, one fully contains the other, or they are
 * concentric.
 */
function intersectCircles(a: Lobe, b: Lobe): [Point, Point] | null {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const d = Math.hypot(dx, dy);
  if (d > a.r + b.r || d < Math.abs(a.r - b.r) || d === 0) return null;
  const t = (a.r * a.r - b.r * b.r + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, a.r * a.r - t * t));
  const mx = a.x + (t * dx) / d;
  const my = a.y + (t * dy) / d;
  const ox = (-dy * h) / d;
  const oy = (dx * h) / d;
  return [
    { x: mx + ox, y: my + oy },
    { x: mx - ox, y: my - oy },
  ];
}

function distSq(p: Point, cx: number, cy: number): number {
  const dx = p.x - cx;
  const dy = p.y - cy;
  return dx * dx + dy * dy;
}

function angleAt(lobe: Lobe, p: Point): number {
  return Math.atan2(p.y - lobe.y, p.x - lobe.x);
}

/**
 * Whether `target` lies on the arc from `start` to `end` going in the
 * specified direction. `anticlockwise=false` means the sweep advances
 * with increasing angle (visually clockwise in y-down canvas
 * coordinates, matching `CanvasRenderingContext2D.arc`'s default).
 * Angles are normalised to `[0, 2π)` before comparison.
 */
function isAngleBetween(
  start: number,
  end: number,
  target: number,
  anticlockwise: boolean,
): boolean {
  const TWO_PI = Math.PI * 2;
  const norm = (a: number): number => ((a % TWO_PI) + TWO_PI) % TWO_PI;
  const s = norm(start);
  const e = norm(end);
  const t = norm(target);
  if (anticlockwise) {
    return s >= e ? t <= s && t >= e : t <= s || t >= e;
  }
  return s <= e ? t >= s && t <= e : t >= s || t <= e;
}

export const buildCloud: PathBuilder = ({ w, h }) => {
  const cx = w / 2;
  const cy = h / 2;
  const m = Math.min(w, h);

  // Six lobes arranged counter-clockwise around the cloud centre.
  // Sized so adjacent pairs overlap cleanly (so `intersectCircles`
  // always yields two solutions). The bottom lobe is slightly larger
  // to keep the silhouette balanced when w >> h or w << h.
  const lobes: Lobe[] = [
    { x: cx - w * 0.30, y: cy + h * 0.10, r: m * 0.26 }, // 0: left
    { x: cx - w * 0.20, y: cy - h * 0.20, r: m * 0.24 }, // 1: upper-left
    { x: cx, y: cy - h * 0.28, r: m * 0.26 }, // 2: top
    { x: cx + w * 0.20, y: cy - h * 0.20, r: m * 0.24 }, // 3: upper-right
    { x: cx + w * 0.30, y: cy + h * 0.10, r: m * 0.26 }, // 4: right
    { x: cx, y: cy + h * 0.22, r: m * 0.28 }, // 5: bottom
  ];
  const N = lobes.length;

  // For each lobe i, compute the OUTER intersection point with lobe
  // (i + 1) % N. This is where the arc on lobe i hands off to the arc
  // on lobe (i + 1).
  const intersections: Point[] = [];
  for (let i = 0; i < N; i++) {
    const a = lobes[i];
    const b = lobes[(i + 1) % N];
    const isect = intersectCircles(a, b);
    if (!isect) {
      // Defensive fallback: shouldn't happen with the tuned values
      // above, but a midpoint keeps the path well-defined under any
      // future edits that might break the overlap invariant.
      intersections.push({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
      continue;
    }
    const [p, q] = isect;
    intersections.push(distSq(p, cx, cy) > distSq(q, cx, cy) ? p : q);
  }

  // Trace the outer arcs. Lobe i's arc spans from
  // `intersections[(i - 1 + N) % N]` (handoff from previous lobe) to
  // `intersections[i]` (handoff to next lobe). The arc must sweep the
  // way that bulges away from the cloud centre — i.e. through the
  // direction pointing from cloud centre to lobe centre.
  const path = new Path2D();
  const startPoint = intersections[N - 1];
  path.moveTo(startPoint.x, startPoint.y);
  for (let i = 0; i < N; i++) {
    const lobe = lobes[i];
    const startP = intersections[(i - 1 + N) % N];
    const endP = intersections[i];
    const startAngle = angleAt(lobe, startP);
    const endAngle = angleAt(lobe, endP);
    const outwardAngle = Math.atan2(lobe.y - cy, lobe.x - cx);
    const cwContainsOutward = isAngleBetween(startAngle, endAngle, outwardAngle, false);
    const anticlockwise = !cwContainsOutward;
    path.arc(lobe.x, lobe.y, lobe.r, startAngle, endAngle, anticlockwise);
  }
  path.closePath();
  return path;
};
