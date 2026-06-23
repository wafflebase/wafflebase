import type { PathBuilder, AdjustmentSpec, AdjustmentHandle } from '../builder';
import { adj } from '../builder';
import { linearTopEdgeHandle } from '../handles';

/**
 * `mathPlus` — `+` glyph as a single 12-vertex cross polygon, matching
 * the ECMA-376 `mathPlus` preset.
 *
 * Adjustments (`MATH_PLUS_ADJUSTMENTS`):
 *   [0] armThickness — OOXML thousandths of `min(w,h)`. Default 23520.
 *
 * OOXML proportions (decoded at default adj, units = fraction of dim):
 *   - Bars span only `73.49%` of the frame, centred:
 *     `dx1 = w * 73490/200000` (half-width), so the horizontal bar runs
 *     `[hc - dx1, hc + dx1]` — NOT the full width. The vertical bar runs
 *     `[vc - dy1, vc + dy1]` with `dy1 = h * 73490/200000`.
 *   - Arm half-thickness `dx2 = min(w,h) * a1/200000`.
 *
 * Implemented as one closed polygon outlining the union of the two
 * shorter bars; two separate rects would each stroke independently and
 * paint a visible square outline where they overlap.
 */
export const MATH_PLUS_ADJUSTMENTS: readonly AdjustmentSpec[] = [
  { name: 'Arm thickness', defaultValue: 23520, min: 0, max: 50000 },
];

export const buildMathPlus: PathBuilder = ({ w, h }, adjustments) => {
  const a1 = Math.max(0, Math.min(adj(adjustments, 0, 23520), 73490));
  const dx1 = (w * 73490) / 200000; // half bar-width (73.49% of w)
  const dy1 = (h * 73490) / 200000; // half bar-height (73.49% of h)
  const dx2 = (Math.min(w, h) * a1) / 200000; // half arm-thickness
  const hc = w / 2;
  const vc = h / 2;
  const x1 = hc - dx1;
  const x2 = hc - dx2;
  const x3 = hc + dx2;
  const x4 = hc + dx1;
  const y1 = vc - dy1;
  const y2 = vc - dx2;
  const y3 = vc + dx2;
  const y4 = vc + dy1;
  const path = new Path2D();
  path.moveTo(x1, y2);
  path.lineTo(x2, y2);
  path.lineTo(x2, y1);
  path.lineTo(x3, y1);
  path.lineTo(x3, y2);
  path.lineTo(x4, y2);
  path.lineTo(x4, y3);
  path.lineTo(x3, y3);
  path.lineTo(x3, y4);
  path.lineTo(x2, y4);
  path.lineTo(x2, y3);
  path.lineTo(x1, y3);
  path.closePath();
  return path;
};

// The arm-thickness handle paints on the upper-left inner notch corner
// (x2, y1) = (hc - dx2, vc - dy1) — the natural anchor for thickness.
// We track it along the top edge of the vertical bar: forward maps the
// adjustment to the inner-notch x (hc - dx2); inverse maps a pointer x
// back to the thickness fraction of min(w,h).
export const MATH_PLUS_HANDLES: readonly AdjustmentHandle[] = [
  linearTopEdgeHandle({
    forward: (adjVal, { w, h }) => {
      const a1 = Math.max(0, Math.min(adjVal, 73490));
      const dx2 = (Math.min(w, h) * a1) / 200000;
      return w / 2 - dx2;
    },
    inverse: (x, { w, h }) => {
      const dx2 = w / 2 - x;
      const m = Math.min(w, h);
      return m > 0 ? (dx2 * 200000) / m : 0;
    },
    spec: MATH_PLUS_ADJUSTMENTS[0],
  }),
];
