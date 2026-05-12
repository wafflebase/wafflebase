import type { PathBuilder, AdjustmentSpec, AdjustmentHandle } from '../builder';
import { adj } from '../builder';
import { linearTopEdgeHandle } from '../handles';
import { pointTailHandle } from './handles';

/**
 * `wedgeRoundRectCallout` — rounded speech bubble with a triangular
 * tail. Combines the rounded-rectangle outline with the wedge-callout
 * tail logic.
 *
 * Adjustments (`WEDGE_ROUND_RECT_CALLOUT_ADJUSTMENTS`):
 *   [0] tailX        — OOXML thousandths of `w`, from frame centre.
 *                      Default -20833.
 *   [1] tailY        — OOXML thousandths of `h`, from frame centre.
 *                      Default 62500.
 *   [2] cornerRadius — OOXML thousandths of `min(w, h)`. Default 16667.
 *
 * For brevity this builder only sprouts a tail when the default
 * downward case applies (`ty > h`). Other tail directions are
 * uncommon enough to fall back to a plain rounded rect.
 */
export const WEDGE_ROUND_RECT_CALLOUT_ADJUSTMENTS: readonly AdjustmentSpec[] = [
  { name: 'Tail x', defaultValue: -20833, min: -100000, max: 100000 },
  { name: 'Tail y', defaultValue: 62500, min: -100000, max: 100000 },
  { name: 'Corner radius', defaultValue: 16667, min: 0, max: 50000 },
];

export const buildWedgeRoundRectCallout: PathBuilder = ({ w, h }, adjustments) => {
  const tx = w / 2 + (adj(adjustments, 0, -20833) / 100000) * w;
  const ty = h / 2 + (adj(adjustments, 1, 62500) / 100000) * h;
  const r = (adj(adjustments, 2, 16667) / 100000) * Math.min(w, h);
  const baseHalf = Math.min(w, h) * 0.05;
  const path = new Path2D();
  // Rounded rectangle outline (clockwise from top-left curve start).
  path.moveTo(r, 0);
  path.lineTo(w - r, 0);
  path.quadraticCurveTo(w, 0, w, r);
  path.lineTo(w, h - r);
  path.quadraticCurveTo(w, h, w - r, h);
  // Tail on bottom edge if tail is below bubble (default case).
  if (ty > h) {
    path.lineTo(Math.min(w - r, tx + baseHalf), h);
    path.lineTo(tx, ty);
    path.lineTo(Math.max(r, tx - baseHalf), h);
  }
  path.lineTo(r, h);
  path.quadraticCurveTo(0, h, 0, h - r);
  path.lineTo(0, r);
  path.quadraticCurveTo(0, 0, r, 0);
  path.closePath();
  return path;
};

// Two handles: the tail tip (point-axis on x/y around frame centre)
// and the corner radius (linear on the top edge, controlling
// adjustments[2]). The radius handle reuses the same forward/inverse
// math as roundRect — `r = (adj/100000) * min(w,h)`.
export const WEDGE_ROUND_RECT_CALLOUT_HANDLES: readonly AdjustmentHandle[] = [
  pointTailHandle(
    WEDGE_ROUND_RECT_CALLOUT_ADJUSTMENTS[0],
    WEDGE_ROUND_RECT_CALLOUT_ADJUSTMENTS[1],
  ),
  linearTopEdgeHandle({
    forward: (adj, { w, h }) => (adj / 100000) * Math.min(w, h),
    inverse: (x, { w, h }) => (x / Math.min(w, h)) * 100000,
    spec: WEDGE_ROUND_RECT_CALLOUT_ADJUSTMENTS[2],
    index: 2,
  }),
];
