import type {
  ElementInit,
  FreeformCommand,
  FreeformPath,
} from '../../../model/element';
import type { ThemeColor } from '../../../model/theme';
import type { Point } from './insert';

/**
 * Freeform (scribble) insertion. Unlike the parametric shapes — which
 * use the rectangular drag-to-size flow in `buildInsertElement` — a
 * scribble is captured as a stream of pointer positions and committed
 * as a `'freeform'` ShapeElement whose `data.path` mirrors an OOXML
 * `<a:custGeom>` polyline. The geometry is stroke-only (no fill), the
 * Google-Slides / PowerPoint scribble default.
 *
 * Points are normalized to `[0, 1]` of the captured bounding box so the
 * stored path scales with the frame, exactly like an imported custGeom
 * (see `buildFreeformPath`).
 */

// Theme-bound so a scribble follows the deck palette like every other
// inserted shape; users override via the Stroke picker.
const STROKE_COLOR: ThemeColor = { kind: 'role', role: 'text' };
const STROKE_WIDTH = 2;

/**
 * Minimum frame extent (slide-logical px) on either axis. A perfectly
 * horizontal or vertical scribble has zero span on one axis; clamp so
 * the frame stays selectable and normalization never divides by zero.
 */
const MIN_SPAN = 1;

/**
 * Build the `ElementInit` for a freeform scribble from the captured
 * point stream. Returns `null` for a degenerate gesture (fewer than two
 * points) so a stray click in scribble mode commits nothing.
 */
export function buildFreeformInit(points: readonly Point[]): ElementInit | null {
  if (points.length < 2) return null;

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

  const commands: FreeformCommand[] = points.map((p, i) => {
    const x = (p.x - minX) / w;
    const y = (p.y - minY) / h;
    return i === 0 ? { c: 'M', x, y } : { c: 'L', x, y };
  });
  const path: FreeformPath = { commands };

  return {
    type: 'shape',
    frame: { x: minX, y: minY, w, h, rotation: 0 },
    data: {
      kind: 'freeform',
      path,
      stroke: { color: STROKE_COLOR, width: STROKE_WIDTH },
    },
  };
}
