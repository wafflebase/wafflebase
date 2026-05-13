import type {
  AdjustmentHandle,
  AdjustmentSpec,
  PathBuilder,
} from '../builder';
import { adj } from '../builder';
import { polylineArc } from '../curves';
import { linearTopEdgeHandle } from '../handles';

/**
 * `horizontalScroll` — horizontal banner with curled roll ends on
 * top and bottom edges. `adj1` controls the roll thickness as a
 * fraction of `min(w, h)`. V0 uses semicircular polyline arcs
 * for the rolls.
 */
// Default 18750 (≈ 19 % of `min(w, h)`) keeps both diagonal-corner
// roll discs visible at 140 × 100 picker / cell sizes. OOXML's
// 12500 default renders as near-invisible specks.
export const HORIZONTAL_SCROLL_ADJUSTMENTS: readonly AdjustmentSpec[] = [
  { name: 'Roll thickness', defaultValue: 18750, min: 0, max: 25000 },
];

export const buildHorizontalScroll: PathBuilder = ({ w, h }, adjustments) => {
  const a1 = adj(adjustments, 0, 18750);
  const r = (a1 / 100000) * Math.min(w, h);
  const path = new Path2D();
  // Main rectangle body inset by `r` on the vertical sides for rolls.
  path.moveTo(r, 0);
  path.lineTo(w - r, 0);
  path.lineTo(w - r, h);
  path.lineTo(r, h);
  path.closePath();
  // Left roll: small disc with a tail going east into the body.
  const leftRoll = polylineArc(r, r, r, r, 0, 2 * Math.PI, 16);
  path.moveTo(leftRoll[0].x, leftRoll[0].y);
  for (let i = 1; i < leftRoll.length; i++) {
    path.lineTo(leftRoll[i].x, leftRoll[i].y);
  }
  path.closePath();
  // Right roll mirrored.
  const rightRoll = polylineArc(w - r, h - r, r, r, 0, 2 * Math.PI, 16);
  path.moveTo(rightRoll[0].x, rightRoll[0].y);
  for (let i = 1; i < rightRoll.length; i++) {
    path.lineTo(rightRoll[i].x, rightRoll[i].y);
  }
  path.closePath();
  return path;
};

export const HORIZONTAL_SCROLL_HANDLES: readonly AdjustmentHandle[] = [
  linearTopEdgeHandle({
    forward: (val, { w, h }) => (val / 100000) * Math.min(w, h),
    inverse: (x, { w, h }) => (x / Math.min(w, h)) * 100000,
    spec: HORIZONTAL_SCROLL_ADJUSTMENTS[0],
  }),
];
