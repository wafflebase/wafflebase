import type { Element, ShapeElement } from '../../model/element';
import type { ConnectorElement } from '../../model/connector';
import { containsPoint, toLocal } from '../../model/frame';
import { PATH_BUILDERS } from '../canvas/shapes';
import { isActionButton } from '../canvas/shapes/action-buttons';
import { EVENODD_KINDS, OPEN_PATH_KINDS } from '../canvas/shape-renderer';
import { resolveEndpoint } from '../canvas/connector-frame';

/** Default click tolerance, in slide-logical pixels. */
export const DEFAULT_HIT_TOLERANCE = 6;

/**
 * Minimal 2D context surface that `hitTestElement` needs. Production
 * passes the real canvas 2D context; tests pass the `createTestCanvas`
 * shim from `view/canvas/test-canvas-env.ts`.
 */
export interface HitTestCtx {
  isPointInPath(
    path: Path2D,
    x: number,
    y: number,
    fillRule?: CanvasFillRule,
  ): boolean;
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
 * - filled shape with a registered path builder → `isPointInPath`
 *   against the local `Path2D`, with rotation + `flipH/flipV` inverted.
 * - stroke-only shape (no `data.fill`) and `OPEN_PATH_KINDS`
 *   (brackets/braces) → bbox. Their outline is a thin polyline; an
 *   `isPointInPath` against the auto-closed shape would include large
 *   visually-empty regions. Stroke-distance hit-test for these is
 *   tracked separately (see task doc).
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
  return hitShape(el, px, py, ctx);
}

function hitShape(
  el: ShapeElement,
  px: number,
  py: number,
  ctx: HitTestCtx,
): boolean {
  const frame = el.frame;
  // Fast bbox reject: anything outside the rotated bbox is also outside
  // the path. Saves a Path2D rebuild for off-shape clicks.
  if (!containsPoint(frame, px, py)) return false;

  // Action buttons paint via a dedicated renderer (`drawActionButton`)
  // that is NOT in PATH_BUILDERS — they have a body + glyph. Selection
  // stays bbox-based.
  if (isActionButton(el.data.kind)) return true;

  // Stroke-only kinds (no fill, or open-path brackets/braces) fall back
  // to bbox. See module doc for the trade-off.
  if (!el.data.fill || OPEN_PATH_KINDS.has(el.data.kind)) return true;

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
  const fillRule: CanvasFillRule = EVENODD_KINDS.has(el.data.kind)
    ? 'evenodd'
    : 'nonzero';
  return ctx.isPointInPath(path, lx, ly, fillRule);
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
  const a = resolveEndpoint(el.start, elements);
  const b = resolveEndpoint(el.end, elements);
  // PR1 supports straight routing only — single segment. Elbow/curved
  // routings extend this to a polyline / sampled bezier (see task doc).
  return distanceToSegment(px, py, a.x, a.y, b.x, b.y) <= limit;
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
