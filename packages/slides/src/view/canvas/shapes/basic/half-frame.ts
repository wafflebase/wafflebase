import type { AdjustmentHandle, AdjustmentSpec, PathBuilder } from '../builder';
import { adj } from '../builder';
import { linearLeftEdgeHandle, linearTopEdgeHandle } from '../handles';

/**
 * `halfFrame` — L-shape covering the NW corner of the frame, matching the
 * ECMA-376 `halfFrame` preset. The top arm has thickness `adj1`, the left
 * arm has thickness `adj2`, both expressed in OOXML thousandths derived
 * from the smaller side (`ss`). The free ends of the two arms are mitred
 * at 45°-style diagonals rather than cut square: the top arm's right tip
 * and the left arm's bottom tip slope back toward the inner corner.
 *
 * OOXML gdLst (the cross-terms use w/h, NOT ss):
 *   x1  = ss · a2 / 100000          (left-arm thickness)
 *   y1  = ss · a1 / 100000          (top-arm thickness)
 *   dx2 = y1 · w / h ;  x2 = r − dx2 (top-arm right tip, outer x)
 *   dy2 = x1 · h / w ;  y2 = b − dy2 (left-arm bottom tip, outer y)
 *
 * Path (6 vertices): (l,t) → (r,t) → (x2,y1) → (x1,y1) → (x1,y2) → (l,b).
 */
export const HALF_FRAME_ADJUSTMENTS: readonly AdjustmentSpec[] = [
  {
    name: 'Top arm thickness',
    defaultValue: 33333,
    min: 0,
    max: 100000,
    axisLabel: 'top',
  },
  {
    name: 'Left arm thickness',
    defaultValue: 33333,
    min: 0,
    max: 100000,
    axisLabel: 'left',
  },
];

export const buildHalfFrame: PathBuilder = ({ w, h }, adjustments) => {
  const a1 = adj(adjustments, 0, HALF_FRAME_ADJUSTMENTS[0].defaultValue);
  const a2 = adj(adjustments, 1, HALF_FRAME_ADJUSTMENTS[1].defaultValue);
  const ss = Math.min(w, h);
  // Left-arm thickness (x1) and top-arm thickness (y1), both off `ss`.
  const x1 = (a2 / 100000) * ss;
  const y1 = (a1 / 100000) * ss;
  // Mitred free ends: the tips slope back toward the inner corner using
  // the w/h cross-terms from the OOXML gdLst.
  const x2 = w - (y1 * w) / h; // top-arm right tip, outer x
  const y2 = h - (x1 * h) / w; // left-arm bottom tip, outer y
  const path = new Path2D();
  path.moveTo(0, 0); // (l, t)
  path.lineTo(w, 0); // (r, t)
  path.lineTo(x2, y1); // top-arm right tip, outer (mitred)
  path.lineTo(x1, y1); // inner corner of top arm
  path.lineTo(x1, y2); // inner corner of left arm
  path.lineTo(0, h); // (l, b) — left-arm bottom tip, outer (mitred)
  path.closePath();
  return path;
};

export const HALF_FRAME_HANDLES: readonly AdjustmentHandle[] = [
  // Top-arm thickness diamond paints on the left edge at y1 = (a1/100000)·ss.
  // Dragging down increases the top-arm thickness.
  linearLeftEdgeHandle({
    forward: (a, { w, h }) => (a / 100000) * Math.min(w, h),
    inverse: (y, { w, h }) => (y / Math.min(w, h)) * 100000,
    spec: HALF_FRAME_ADJUSTMENTS[0],
    index: 0,
  }),
  // Left-arm thickness diamond paints on the top edge at x1 = (a2/100000)·ss.
  linearTopEdgeHandle({
    forward: (a, { w, h }) => (a / 100000) * Math.min(w, h),
    inverse: (x, { w, h }) => (x / Math.min(w, h)) * 100000,
    spec: HALF_FRAME_ADJUSTMENTS[1],
    index: 1,
  }),
];
