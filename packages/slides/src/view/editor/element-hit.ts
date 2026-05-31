import type { Element, ShapeElement } from '../../model/element';
import type { ConnectorElement } from '../../model/connector';
import { containsPoint, toLocal } from '../../model/frame';
import { PATH_BUILDERS } from '../canvas/shapes';
import { isActionButton } from '../canvas/shapes/action-buttons';
import { EVENODD_KINDS, OPEN_PATH_KINDS } from '../canvas/shape-renderer';
import { buildConnectorPath } from '../canvas/connector-frame';
import { type BezierPath, isBezierPath } from '../canvas/routing';

/** Default click tolerance, in slide-logical pixels. */
export const DEFAULT_HIT_TOLERANCE = 6;

/**
 * Minimal 2D context surface that `hitTestElement` needs. Production
 * passes the real canvas 2D context; tests pass the `createTestCanvas`
 * shim from `view/canvas/test-canvas-env.ts`.
 *
 * `isPointInStroke` is optional only because some hand-rolled stubs
 * (rare; not the shipped shim) might omit it. When absent the
 * stroke-band fallback degrades to bbox for unfilled shapes.
 */
export interface HitTestCtx {
  isPointInPath(
    path: Path2D,
    x: number,
    y: number,
    fillRule?: CanvasFillRule,
  ): boolean;
  isPointInStroke?(path: Path2D, x: number, y: number): boolean;
  /** Honoured by `isPointInStroke` to set the band thickness. */
  lineWidth?: number;
}

export interface HitTestOptions {
  /**
   * Click tolerance in slide-logical pixels. Applied to connectors so
   * thin lines stay clickable. Defaults to {@link DEFAULT_HIT_TOLERANCE}.
   */
  tolerance?: number;
  /**
   * Element lookup needed by connectors with attached endpoints.
   * Defaults to an empty map; attached endpoints then fall back to
   * the origin per `resolveEndpoint`.
   */
  elements?: ReadonlyMap<string, Element>;
}

const EMPTY_LOOKUP: ReadonlyMap<string, Element> = new Map();

/**
 * True iff the slide-logical point `(px, py)` lies on the visible
 * drawn area of `el`. Used by selection and right-click hit-test.
 *
 * - text / image / action-button shapes → bbox (`containsPoint`).
 * - shape with a registered path builder:
 *   - filled (and not `OPEN_PATH_KINDS`) → `isPointInPath` against the
 *     local `Path2D`, with rotation + `flipH/flipV` inverted.
 *   - then a stroke band fallback (`isPointInStroke` with
 *     `lineWidth = stroke.width + 2*tolerance`) so clicks on or near
 *     the visible outline still hit. Catches the AA fringe + round-
 *     join extension on filled shapes (heart, smileyFace, …) and is
 *     the primary test for stroke-only shapes (brackets/braces,
 *     unfilled outlines).
 *   - no fill and no stroke → invisible, no hit.
 * - connector → distance from `(px, py)` to the routed polyline must
 *   be `≤ stroke.width / 2 + tolerance`.
 */
export function hitTestElement(
  el: Element,
  px: number,
  py: number,
  ctx: HitTestCtx,
  opts: HitTestOptions = {},
): boolean {
  if (el.type === 'connector') return hitConnector(el, px, py, opts);
  if (el.type !== 'shape') return containsPoint(el.frame, px, py);
  return hitShape(el, px, py, ctx, opts);
}

function hitShape(
  el: ShapeElement,
  px: number,
  py: number,
  ctx: HitTestCtx,
  opts: HitTestOptions,
): boolean {
  const frame = el.frame;
  // Action buttons paint via a dedicated renderer (`drawActionButton`)
  // that is NOT in PATH_BUILDERS — they have a body + glyph and no
  // path-based outline to widen. Selection stays strict bbox so the
  // click region doesn't pick up the tolerance halo other shapes use
  // for AA-fringe forgiveness.
  if (isActionButton(el.data.kind)) return containsPoint(frame, px, py);

  const tol = opts.tolerance ?? DEFAULT_HIT_TOLERANCE;
  // Fast bbox reject with a tolerance pad so clicks just outside the
  // bbox — but still within the stroke band — can reach the precise
  // tests below.
  if (!containsPointPadded(frame, px, py, tol)) return false;

  const builder = PATH_BUILDERS.get(el.data.kind);
  if (!builder) return true; // unknown kind → placeholder rect; bbox is what we have.

  const local = toLocal(frame, { x: px, y: py });
  // Invert flipH/flipV in centered local coords. The renderer flips
  // after rotating around the centre, so the path itself stays
  // un-flipped; we map the world hit point into the path's frame
  // instead. Mirrors `connection-sites/index.ts` resolveSite().
  const lx = frame.flipH ? frame.w - local.x : local.x;
  const ly = frame.flipV ? frame.h - local.y : local.y;
  const path = builder({ w: frame.w, h: frame.h }, el.data.adjustments);

  // Visibility gate: the renderer paints `fill` (unless OPEN_PATH) and
  // `stroke` independently. A shape with neither is invisible and
  // therefore not clickable, even though its bbox/frame exists.
  const hasFill =
    el.data.fill !== undefined && !OPEN_PATH_KINDS.has(el.data.kind);
  const hasStroke = el.data.stroke !== undefined;
  if (!hasFill && !hasStroke) return false;

  // 1) Filled body → `isPointInPath` against the path's interior.
  if (hasFill) {
    const fillRule: CanvasFillRule = EVENODD_KINDS.has(el.data.kind)
      ? 'evenodd'
      : 'nonzero';
    if (ctx.isPointInPath(path, lx, ly, fillRule)) return true;
  }

  // 2) Stroke band — clicks on or near the visible outline. Catches
  //    the AA fringe / round-join extension on filled shapes (heart's
  //    lobes, smileyFace's face circle, …) AND is the primary test
  //    for stroke-only shapes (brackets/braces, unfilled outlines).
  if (typeof ctx.isPointInStroke === 'function') {
    const strokeWidth = el.data.stroke?.width ?? 0;
    const lineWidth = strokeWidth + 2 * tol;
    const prev = ctx.lineWidth;
    ctx.lineWidth = lineWidth;
    try {
      if (ctx.isPointInStroke(path, lx, ly)) return true;
    } finally {
      ctx.lineWidth = prev;
    }
  } else if (!hasFill) {
    // No `isPointInStroke` available (custom stub) and no filled body
    // — fall back to bbox so the shape stays selectable.
    return true;
  }

  return false;
}

/**
 * Like `containsPoint`, but inflates the local rect by `pad` on every
 * side. Used as the fast reject for shapes whose visible stroke can
 * extend slightly outside the frame.
 */
function containsPointPadded(
  frame: ShapeElement['frame'],
  px: number,
  py: number,
  pad: number,
): boolean {
  const local = toLocal(frame, { x: px, y: py });
  return (
    local.x >= -pad &&
    local.x <= frame.w + pad &&
    local.y >= -pad &&
    local.y <= frame.h + pad
  );
}

function hitConnector(
  el: ConnectorElement,
  px: number,
  py: number,
  opts: HitTestOptions,
): boolean {
  const elements = opts.elements ?? EMPTY_LOOKUP;
  const tol = opts.tolerance ?? DEFAULT_HIT_TOLERANCE;
  const half = (el.stroke?.width ?? 1) / 2;
  const limit = half + tol;
  const path = buildConnectorPath(el, elements);
  if (isBezierPath(path)) {
    return bezierMinDistance(path, px, py) <= limit;
  }
  const pts = path.points;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    if (a.x === b.x && a.y === b.y) continue;
    if (distanceToSegment(px, py, a.x, a.y, b.x, b.y) <= limit) return true;
  }
  return false;
}

/** Min distance from (px, py) to a cubic bezier, sampled as 32 chord segments. */
function bezierMinDistance(b: BezierPath, px: number, py: number): number {
  const STEPS = 32;
  let prev = b.p0;
  let min = Infinity;
  for (let i = 1; i <= STEPS; i++) {
    const t = i / STEPS;
    const u = 1 - t;
    const x =
      u * u * u * b.p0.x +
      3 * u * u * t * b.c1.x +
      3 * u * t * t * b.c2.x +
      t * t * t * b.p1.x;
    const y =
      u * u * u * b.p0.y +
      3 * u * u * t * b.c1.y +
      3 * u * t * t * b.c2.y +
      t * t * t * b.p1.y;
    const d = distanceToSegment(px, py, prev.x, prev.y, x, y);
    if (d < min) min = d;
    prev = { x, y };
  }
  return min;
}

function distanceToSegment(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  let t = lenSq === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / lenSq;
  if (t < 0) t = 0;
  else if (t > 1) t = 1;
  const cx = ax + t * dx;
  const cy = ay + t * dy;
  const ex = px - cx;
  const ey = py - cy;
  return Math.sqrt(ex * ex + ey * ey);
}
