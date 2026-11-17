import type { Element, ShapeElement } from '../../model/element';
import { toLocal } from '../../model/frame';
import { flattenFreeformPath, type FlatPoint } from '../canvas/shapes/freeform';

/**
 * Geometry for freeform strokes (scribbles, marker ink, imported
 * `<a:custGeom>` lines): how near a point or a swept segment comes to
 * the line a freeform actually paints.
 *
 * A freeform has no `PATH_BUILDERS` entry, so hit-testing used to fall
 * back to its padded bbox. One diagonal stroke then swallowed clicks on
 * every element under its bounding box, and an eraser could not tell a
 * stroke it crossed from one it merely passed near. Both questions are
 * answered here against the flattened path, in element-local
 * coordinates: rotation and flips are rigid, so a distance measured
 * there is the distance on screen (divided by zoom).
 */

/** A freeform shape that carries geometry. */
export type FreeformShape = ShapeElement & {
  data: ShapeElement['data'] & { kind: 'freeform'; path: NonNullable<ShapeElement['data']['path']> };
};

export function isFreeformShape(el: Element | undefined): el is FreeformShape {
  return (
    el !== undefined &&
    el.type === 'shape' &&
    el.data.kind === 'freeform' &&
    el.data.path !== undefined
  );
}

/** World point → the freeform's local (unrotated, unflipped) frame. */
function worldToPathLocal(el: ShapeElement, x: number, y: number): FlatPoint {
  const local = toLocal(el.frame, { x, y });
  return {
    x: el.frame.flipH ? el.frame.w - local.x : local.x,
    y: el.frame.flipV ? el.frame.h - local.y : local.y,
  };
}

function polylines(el: FreeformShape): FlatPoint[][] {
  return flattenFreeformPath({ w: el.frame.w, h: el.frame.h }, el.data.path);
}

/**
 * Smallest distance from world point `(x, y)` to the freeform's painted
 * centre line. `Infinity` for a path with no segments.
 */
export function freeformDistance(el: FreeformShape, x: number, y: number): number {
  const p = worldToPathLocal(el, x, y);
  let min = Infinity;
  for (const line of polylines(el)) {
    if (line.length === 1) {
      min = Math.min(min, Math.hypot(p.x - line[0].x, p.y - line[0].y));
      continue;
    }
    for (let i = 1; i < line.length; i++) {
      const d = pointSegmentDistance(p, line[i - 1], line[i]);
      if (d < min) min = d;
    }
  }
  return min;
}

/**
 * Whether the world segment `a → b`, swept with `radius`, touches the
 * freeform's painted stroke (its centre line widened by half the stroke
 * width). The eraser's test: `a → b` is one pointer step, so a fast
 * swipe that jumps clean over a thin stroke between two events still
 * crosses it.
 */
export function segmentHitsFreeform(
  el: FreeformShape,
  a: FlatPoint,
  b: FlatPoint,
  radius: number,
): boolean {
  const limit = radius + (el.data.stroke?.width ?? 0) / 2;
  // Cheap reject on the frame inflated by the limit. The frame is
  // rotated, so compare in local coordinates against the segment's
  // local bbox.
  const la = worldToPathLocal(el, a.x, a.y);
  const lb = worldToPathLocal(el, b.x, b.y);
  const { w, h } = el.frame;
  if (
    Math.max(la.x, lb.x) < -limit ||
    Math.min(la.x, lb.x) > w + limit ||
    Math.max(la.y, lb.y) < -limit ||
    Math.min(la.y, lb.y) > h + limit
  ) {
    return false;
  }
  for (const line of polylines(el)) {
    if (line.length === 1) {
      if (pointSegmentDistance(line[0], la, lb) <= limit) return true;
      continue;
    }
    for (let i = 1; i < line.length; i++) {
      if (segmentSegmentDistance(la, lb, line[i - 1], line[i]) <= limit) {
        return true;
      }
    }
  }
  return false;
}

export function pointSegmentDistance(p: FlatPoint, a: FlatPoint, b: FlatPoint): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  let t = lenSq === 0 ? 0 : ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
  if (t < 0) t = 0;
  else if (t > 1) t = 1;
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

function cross(o: FlatPoint, a: FlatPoint, b: FlatPoint): number {
  return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
}

/** Distance between segments `p1→p2` and `q1→q2`; 0 when they cross. */
export function segmentSegmentDistance(
  p1: FlatPoint,
  p2: FlatPoint,
  q1: FlatPoint,
  q2: FlatPoint,
): number {
  const d1 = cross(q1, q2, p1);
  const d2 = cross(q1, q2, p2);
  const d3 = cross(p1, p2, q1);
  const d4 = cross(p1, p2, q2);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) {
    return 0;
  }
  return Math.min(
    pointSegmentDistance(p1, q1, q2),
    pointSegmentDistance(p2, q1, q2),
    pointSegmentDistance(q1, p1, p2),
    pointSegmentDistance(q2, p1, p2),
  );
}
