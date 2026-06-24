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
 * Following ECMA-376, the triangular tail points to the target
 * (tailX, tailY) wherever it lies: the tail base sits on whichever of
 * the four rectangle edges is closest to the target, so the tail
 * sprouts left/right/up/down — not only when the target is below the
 * box. Mirrors the closest-edge logic of `buildWedgeRectCallout`, with
 * the tail base clamped to the straight portion of each edge so it
 * never overruns the rounded corners.
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
  // The tail base sits on whichever edge is closest to the target.
  const distances = [
    { side: 'top', d: Math.abs(ty - 0) },
    { side: 'right', d: Math.abs(tx - w) },
    { side: 'bottom', d: Math.abs(ty - h) },
    { side: 'left', d: Math.abs(tx - 0) },
  ] as const;
  const closest = distances.reduce((a, b) => (a.d < b.d ? a : b)).side;
  // Clamp the base anchor to the straight run of an edge so it never
  // overlaps a rounded corner (corners span `r` from each end).
  const clampX = (x: number): number => Math.max(r, Math.min(w - r, x));
  const clampY = (y: number): number => Math.max(r, Math.min(h - r, y));
  const path = new Path2D();
  // Rounded rectangle outline (clockwise from top-left curve start).
  path.moveTo(r, 0);
  // Top edge with optional tail.
  if (closest === 'top') {
    path.lineTo(clampX(tx - baseHalf), 0);
    path.lineTo(tx, ty);
    path.lineTo(clampX(tx + baseHalf), 0);
  }
  path.lineTo(w - r, 0);
  path.quadraticCurveTo(w, 0, w, r);
  // Right edge with optional tail.
  if (closest === 'right') {
    path.lineTo(w, clampY(ty - baseHalf));
    path.lineTo(tx, ty);
    path.lineTo(w, clampY(ty + baseHalf));
  }
  path.lineTo(w, h - r);
  path.quadraticCurveTo(w, h, w - r, h);
  // Bottom edge with optional tail (default case).
  if (closest === 'bottom') {
    path.lineTo(clampX(tx + baseHalf), h);
    path.lineTo(tx, ty);
    path.lineTo(clampX(tx - baseHalf), h);
  }
  path.lineTo(r, h);
  path.quadraticCurveTo(0, h, 0, h - r);
  // Left edge with optional tail.
  if (closest === 'left') {
    path.lineTo(0, clampY(ty + baseHalf));
    path.lineTo(tx, ty);
    path.lineTo(0, clampY(ty - baseHalf));
  }
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
