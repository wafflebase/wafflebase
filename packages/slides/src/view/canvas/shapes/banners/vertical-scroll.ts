import type {
  AdjustmentHandle,
  AdjustmentSpec,
  PathBuilder,
} from '../builder';
import { adj } from '../builder';
import { polylineArc } from '../curves';
import { linearTopEdgeHandle } from '../handles';

/**
 * `verticalScroll` — vertical version of `horizontalScroll`.
 * Roll discs at top and bottom corners.
 */
// Default bumped to 18750 (matches `horizontalScroll`) so the roll
// discs are visible at picker / cell sizes.
export const VERTICAL_SCROLL_ADJUSTMENTS: readonly AdjustmentSpec[] = [
  { name: 'Roll thickness', defaultValue: 18750, min: 0, max: 25000 },
];

export const buildVerticalScroll: PathBuilder = ({ w, h }, adjustments) => {
  const a1 = adj(adjustments, 0, 18750);
  const r = (a1 / 100000) * Math.min(w, h);
  const path = new Path2D();
  path.moveTo(0, r);
  path.lineTo(w, r);
  path.lineTo(w, h - r);
  path.lineTo(0, h - r);
  path.closePath();
  const topRoll = polylineArc(r, r, r, r, 0, 2 * Math.PI, 16);
  path.moveTo(topRoll[0].x, topRoll[0].y);
  for (let i = 1; i < topRoll.length; i++) {
    path.lineTo(topRoll[i].x, topRoll[i].y);
  }
  path.closePath();
  const bottomRoll = polylineArc(w - r, h - r, r, r, 0, 2 * Math.PI, 16);
  path.moveTo(bottomRoll[0].x, bottomRoll[0].y);
  for (let i = 1; i < bottomRoll.length; i++) {
    path.lineTo(bottomRoll[i].x, bottomRoll[i].y);
  }
  path.closePath();
  return path;
};

export const VERTICAL_SCROLL_HANDLES: readonly AdjustmentHandle[] = [
  linearTopEdgeHandle({
    forward: (val, { w, h }) => (val / 100000) * Math.min(w, h),
    inverse: (x, { w, h }) => (x / Math.min(w, h)) * 100000,
    spec: VERTICAL_SCROLL_ADJUSTMENTS[0],
  }),
];
