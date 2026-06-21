// packages/slides/src/view/canvas/shapes/preset/path.ts
//
// Interpreter that turns a `PresetShapeDef` into a `Path2D`. Arcs and
// Béziers are flattened to polylines — the same "one code path for
// tests and production" rule the rest of the shape layer follows
// (see `curves.ts`): the JSDOM canvas shim used by Vitest has
// incomplete `arcTo`/`quadraticCurveTo` support, and browser
// anti-alias makes the flattened approximation indistinguishable from
// a native curve at slide scale.

import type { FrameSize, PathBuilder, Point } from '../builder';
import { evalGuides, ooxmlAngleToRad, type Resolver } from './formula';
import type { PresetPt, PresetShapeDef } from './types';

/** Segments per full 360° arc; matches `curves.ts` DEFAULT_ARC_SEGMENTS. */
const ARC_SEGMENTS_PER_TURN = 32;
/** Flattening resolution for quadratic / cubic Béziers. */
const BEZIER_SEGMENTS = 24;

function pt(p: PresetPt, r: Resolver): Point {
  return { x: r(p.x), y: r(p.y) };
}

/**
 * The point on an ellipse of radii (wR, hR) centred at the origin at
 * *geometric* angle `g` (the angle of the ray from the centre), i.e.
 * the ray–ellipse intersection. DrawingML `arcTo` angles are geometric
 * angles, NOT the ellipse parameter, so for `wR ≠ hR` we must intersect
 * the ray rather than plug the angle into `(wR cos, hR sin)`. This form
 * is continuous in `g` (no `atan2` wrap), so sweeps past ±180° need no
 * unwrapping. For a circle (`wR == hR`) it reduces to `(wR cos, wR sin)`.
 */
function ellipseRayPoint(wR: number, hR: number, g: number): Point {
  const cg = Math.cos(g);
  const sg = Math.sin(g);
  const denom = Math.hypot(hR * cg, wR * sg);
  const r = denom === 0 ? 0 : (wR * hR) / denom;
  return { x: r * cg, y: r * sg };
}

/** Append an OOXML `arcTo` to `path`, returning the new pen position. */
function appendArc(
  path: Path2D,
  cur: Point,
  wR: number,
  hR: number,
  stAng: number,
  swAng: number,
): Point {
  const st = ooxmlAngleToRad(stAng);
  const sw = ooxmlAngleToRad(swAng);
  // The current pen position is the arc's start point — the ellipse
  // point at geometric angle `st` — so the centre is cur minus that
  // offset. Every sample then uses the same centre.
  const p0 = ellipseRayPoint(wR, hR, st);
  const cx = cur.x - p0.x;
  const cy = cur.y - p0.y;
  const segments = Math.max(
    1,
    Math.ceil((Math.abs(sw) / (2 * Math.PI)) * ARC_SEGMENTS_PER_TURN),
  );
  let last = cur;
  for (let i = 1; i <= segments; i++) {
    const g = st + (sw * i) / segments;
    const p = ellipseRayPoint(wR, hR, g);
    last = { x: cx + p.x, y: cy + p.y };
    path.lineTo(last.x, last.y);
  }
  return last;
}

function appendQuad(path: Path2D, p0: Point, c: Point, p1: Point): Point {
  for (let i = 1; i <= BEZIER_SEGMENTS; i++) {
    const t = i / BEZIER_SEGMENTS;
    const mt = 1 - t;
    const x = mt * mt * p0.x + 2 * mt * t * c.x + t * t * p1.x;
    const y = mt * mt * p0.y + 2 * mt * t * c.y + t * t * p1.y;
    path.lineTo(x, y);
  }
  return { ...p1 };
}

function appendCubic(
  path: Path2D,
  p0: Point,
  c1: Point,
  c2: Point,
  p1: Point,
): Point {
  for (let i = 1; i <= BEZIER_SEGMENTS; i++) {
    const t = i / BEZIER_SEGMENTS;
    const mt = 1 - t;
    const x =
      mt * mt * mt * p0.x +
      3 * mt * mt * t * c1.x +
      3 * mt * t * t * c2.x +
      t * t * t * p1.x;
    const y =
      mt * mt * mt * p0.y +
      3 * mt * mt * t * c1.y +
      3 * mt * t * t * c2.y +
      t * t * t * p1.y;
    path.lineTo(x, y);
  }
  return { ...p1 };
}

/**
 * Build a `Path2D` from a preset definition for a given frame size and
 * adjustment array.
 *
 * Only the *silhouette* sub-paths are rendered — those with no `fill`
 * attribute or `fill="norm"`. DrawingML also carries:
 *   - `fill="none"` — stroke-only outline (no fill), and
 *   - `fill="darken" | "darkenLess" | "lighten" | "lightenLess"` —
 *     3-D shading overlays drawn in a modified shade of the same fill
 *     over a *sub-region* of the silhouette.
 * Both are skipped: a flat renderer has no shading, and filling a
 * shading overlay as if it were silhouette paints a spurious blob.
 * For our arrows the `norm` body path is already the complete outline,
 * so this also avoids any body/head seam.
 */
export function buildPresetPath(
  def: PresetShapeDef,
  size: FrameSize,
  adjustments?: number[],
): Path2D {
  const r = evalGuides(size, def, adjustments);
  const path = new Path2D();
  for (const sub of def.paths) {
    if (sub.fill !== undefined && sub.fill !== 'norm') continue;
    let cur: Point = { x: 0, y: 0 };
    let start: Point = { x: 0, y: 0 };
    for (const cmd of sub.cmds) {
      switch (cmd.t) {
        case 'move': {
          cur = pt(cmd.pt, r);
          start = { ...cur };
          path.moveTo(cur.x, cur.y);
          break;
        }
        case 'line': {
          cur = pt(cmd.pt, r);
          path.lineTo(cur.x, cur.y);
          break;
        }
        case 'arc': {
          cur = appendArc(
            path,
            cur,
            r(cmd.wR),
            r(cmd.hR),
            r(cmd.stAng),
            r(cmd.swAng),
          );
          break;
        }
        case 'quad': {
          cur = appendQuad(path, cur, pt(cmd.c, r), pt(cmd.pt, r));
          break;
        }
        case 'cubic': {
          cur = appendCubic(
            path,
            cur,
            pt(cmd.c1, r),
            pt(cmd.c2, r),
            pt(cmd.pt, r),
          );
          break;
        }
        case 'close': {
          path.closePath();
          cur = { ...start };
          break;
        }
      }
    }
  }
  return path;
}

/** Curry a preset definition into the registry's `PathBuilder` shape. */
export function presetBuilder(def: PresetShapeDef): PathBuilder {
  return (size, adjustments) => buildPresetPath(def, size, adjustments);
}

/**
 * Evaluate a single guide-point for a preset definition — used by
 * adjustment handles to read a `pos`/landmark in element-local coords.
 */
export function presetPoint(
  def: PresetShapeDef,
  size: FrameSize,
  adjustments: number[] | undefined,
  x: string,
  y: string,
): Point {
  const r = evalGuides(size, def, adjustments);
  return { x: r(x), y: r(y) };
}
