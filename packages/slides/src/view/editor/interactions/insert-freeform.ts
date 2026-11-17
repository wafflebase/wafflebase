import type {
  ElementInit,
  FreeformPath,
  Stroke,
} from '../../../model/element';
import type { ThemeColor } from '../../../model/theme';
import type { Point } from './insert';
import { smoothedCommands } from './ink';

/**
 * Freeform (scribble) insertion. Unlike the parametric shapes — which
 * use the rectangular drag-to-size flow in `buildInsertElement` — a
 * scribble is captured as a stream of pointer positions and committed
 * as a `'freeform'` ShapeElement whose `data.path` mirrors an OOXML
 * `<a:custGeom>` path. The geometry is stroke-only (no fill), the
 * Google-Slides / PowerPoint scribble default.
 *
 * The stored path is the captured points with midpoint quadratic
 * smoothing (`ink.ts` `traceSmoothed`): `M`, then `Q`s whose control
 * points are the captured points. That is what the live preview draws,
 * and `Q` round-trips through PPTX as `<a:quadBezTo>`.
 *
 * Points are normalized to `[0, 1]` of the captured bounding box so the
 * stored path scales with the frame, exactly like an imported custGeom
 * (see `buildFreeformPath`). A quadratic stays inside the hull of its
 * control points, so the bbox of the points bounds the curve.
 */

// Theme-bound so a scribble follows the deck palette like every other
// inserted shape; users override via the Stroke picker.
const STROKE_COLOR: ThemeColor = { kind: 'role', role: 'text' };
const STROKE_WIDTH = 2;

/** The stroke a scribble gets when the host supplies none. */
export const DEFAULT_FREEFORM_STROKE: Stroke = {
  color: STROKE_COLOR,
  width: STROKE_WIDTH,
};

/**
 * Minimum frame extent (slide-logical px) on either axis. A perfectly
 * horizontal or vertical scribble has zero span on one axis; clamp so
 * the frame stays selectable and normalization never divides by zero.
 */
const MIN_SPAN = 1;

export interface FreeformInitOptions {
  /** Stroke for the new element. Defaults to {@link DEFAULT_FREEFORM_STROKE}. */
  stroke?: Stroke;
  /**
   * Commit a single point as a dot (a zero-length segment a round cap
   * paints as a disc). Off by default: a stray click in Slides' scribble
   * mode commits nothing, as it always has.
   */
  allowDot?: boolean;
}

/**
 * Build the `ElementInit` for a freeform scribble from the captured
 * point stream. Returns `null` for a degenerate gesture (fewer than two
 * points, unless `allowDot`) so a stray click commits nothing.
 */
export function buildFreeformInit(
  points: readonly Point[],
  opts: FreeformInitOptions = {},
): ElementInit | null {
  if (points.length === 0) return null;
  if (points.length < 2 && !opts.allowDot) return null;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }

  const w = Math.max(MIN_SPAN, maxX - minX);
  const h = Math.max(MIN_SPAN, maxY - minY);

  const path: FreeformPath = {
    commands: smoothedCommands(points, (p) => ({
      x: (p.x - minX) / w,
      y: (p.y - minY) / h,
    })),
  };

  return {
    type: 'shape',
    frame: { x: minX, y: minY, w, h, rotation: 0 },
    data: {
      kind: 'freeform',
      path,
      stroke: { ...(opts.stroke ?? DEFAULT_FREEFORM_STROKE) },
    },
  };
}
