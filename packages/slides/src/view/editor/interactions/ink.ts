import type { FreeformCommand } from '../../../model/element';
import type { Point } from './insert';

/**
 * Stroke-quality helpers for freehand ink (scribble / marker /
 * highlighter). Pure, so the capture loop in `ink-capture.ts`, the
 * stored path in `insert-freeform.ts`, and the live preview in
 * `live-ink-layer.ts` all draw the same curve.
 */

/**
 * Minimum travel, in SCREEN px, between two retained points. Converted
 * to world units by the caller (`÷ zoom`) so a stroke drawn zoomed out
 * is not decimated into a polygon, nor one drawn zoomed in bloated with
 * near-duplicates.
 */
export const INK_MIN_STEP_SCREEN_PX = 1.5;

/**
 * Ramer–Douglas–Peucker tolerance on commit, in SCREEN px. Below a
 * pixel, so simplification never visibly changes the line; it mostly
 * drops the collinear runs a slow straight drag produces.
 */
export const INK_SIMPLIFY_SCREEN_PX = 0.6;

/** Angle step, in degrees, that a Shift-held straight stroke snaps to. */
export const INK_SNAP_DEGREES = 15;

/**
 * Append `p` to `points` unless it is within `minStep` (world units) of
 * the last retained point. Returns whether it was kept.
 */
export function pushDecimated(points: Point[], p: Point, minStep: number): boolean {
  const last = points[points.length - 1];
  if (last !== undefined) {
    const dx = p.x - last.x;
    const dy = p.y - last.y;
    if (dx * dx + dy * dy < minStep * minStep) return false;
  }
  points.push(p);
  return true;
}

/**
 * Ramer–Douglas–Peucker simplification: keep the endpoints, and any
 * point further than `epsilon` from the chord of the run it sits in.
 * Iterative (an explicit stack) so a very long stroke cannot overflow
 * the call stack.
 */
export function simplifyStroke(points: readonly Point[], epsilon: number): Point[] {
  if (points.length <= 2 || epsilon <= 0) return points.slice();
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack: Array<[number, number]> = [[0, points.length - 1]];
  while (stack.length > 0) {
    const [first, last] = stack.pop()!;
    const a = points[first];
    const b = points[last];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    let maxDist = -1;
    let index = -1;
    for (let i = first + 1; i < last; i++) {
      const p = points[i];
      const d =
        len === 0
          ? Math.hypot(p.x - a.x, p.y - a.y)
          : Math.abs(dy * p.x - dx * p.y + b.x * a.y - b.y * a.x) / len;
      if (d > maxDist) {
        maxDist = d;
        index = i;
      }
    }
    if (index !== -1 && maxDist > epsilon) {
      keep[index] = 1;
      stack.push([first, index], [index, last]);
    }
  }
  const out: Point[] = [];
  for (let i = 0; i < points.length; i++) if (keep[i]) out.push(points[i]);
  return out;
}

/**
 * Snap `p` onto the ray from `start` whose angle is the nearest multiple
 * of `stepDeg`, keeping its distance from `start`. Shift-held drawing.
 */
export function snapStraight(start: Point, p: Point, stepDeg = INK_SNAP_DEGREES): Point {
  const dx = p.x - start.x;
  const dy = p.y - start.y;
  const len = Math.hypot(dx, dy);
  if (len === 0) return { x: start.x, y: start.y };
  const step = (stepDeg * Math.PI) / 180;
  const angle = Math.round(Math.atan2(dy, dx) / step) * step;
  return { x: start.x + len * Math.cos(angle), y: start.y + len * Math.sin(angle) };
}

/** The drawing calls {@link traceSmoothed} issues; a ctx or a Path2D. */
export interface PathSink {
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  quadraticCurveTo(cpx: number, cpy: number, x: number, y: number): void;
}

/**
 * Midpoint quadratic smoothing: each captured point becomes the control
 * point of a quadratic from the previous segment's midpoint to the next
 * one's, so the line passes smoothly through the midpoints instead of
 * kinking at every sample. The first and last points are hit exactly.
 *
 * `map` converts a stored point into the sink's space (world → screen
 * for the live layer, world → normalized for the stored path).
 */
export function traceSmoothed(
  sink: PathSink,
  points: readonly Point[],
  map: (p: Point) => Point = (p) => p,
): void {
  if (points.length === 0) return;
  const p0 = map(points[0]);
  sink.moveTo(p0.x, p0.y);
  if (points.length === 1) {
    // A dot: a zero-length segment, which a round cap paints as a disc.
    sink.lineTo(p0.x, p0.y);
    return;
  }
  if (points.length === 2) {
    const p1 = map(points[1]);
    sink.lineTo(p1.x, p1.y);
    return;
  }
  for (let i = 1; i < points.length - 1; i++) {
    const c = map(points[i]);
    const n = map(points[i + 1]);
    const mx = (c.x + n.x) / 2;
    const my = (c.y + n.y) / 2;
    if (i === points.length - 2) {
      sink.quadraticCurveTo(c.x, c.y, n.x, n.y);
    } else {
      sink.quadraticCurveTo(c.x, c.y, mx, my);
    }
  }
}

/**
 * {@link traceSmoothed} as stored `FreeformCommand`s (`M`, then `Q`s, or
 * a single `L` for two points), so the committed element paints, hit-
 * tests and exports to PPTX (`<a:quadBezTo>`) as the smooth curve the
 * user saw while drawing.
 */
export function smoothedCommands(
  points: readonly Point[],
  map: (p: Point) => Point,
): FreeformCommand[] {
  const commands: FreeformCommand[] = [];
  traceSmoothed(
    {
      moveTo: (x, y) => commands.push({ c: 'M', x, y }),
      lineTo: (x, y) => commands.push({ c: 'L', x, y }),
      quadraticCurveTo: (x1, y1, x, y) => commands.push({ c: 'Q', x1, y1, x, y }),
    },
    points,
    map,
  );
  return commands;
}
