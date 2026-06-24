import type { PathBuilder, AdjustmentSpec, AdjustmentHandle } from '../builder';
import { adj } from '../builder';
import { linearTopEdgeHandle } from '../handles';

/**
 * `plus` — cross / plus sign filling the frame.
 *
 * Adjustments:
 *   [0] adj — OOXML edge inset `x1 = ss*adj/100000` (thousandths of
 *       `ss = min(w,h)`); default 25000. The arms span `x1..(w-x1)`
 *       horizontally and `x1..(h-x1)` vertically, so at the default
 *       the arm band is 50% of each dimension.
 */
export const PLUS_ADJUSTMENTS: readonly AdjustmentSpec[] = [
  { name: 'Arm thickness', defaultValue: 25000, min: 0, max: 50000 },
];

export const buildPlus: PathBuilder = ({ w, h }, adjustments) => {
  // OOXML: x1 = ss * adj / 100000 is the edge INSET (not the arm
  // thickness). The vertical arm spans x1..(w-x1); the horizontal
  // arm spans x1..(h-x1). At adj=25000 → x1 = 25% of ss, so the arm
  // band is 50% of the dimension.
  const ss = Math.min(w, h);
  const x1 = (adj(adjustments, 0, 25000) / 100000) * ss;
  const x2 = w - x1; // right edge of the vertical arm
  const y2 = h - x1; // bottom edge of the horizontal arm
  const path = new Path2D();
  path.moveTo(0, x1);
  path.lineTo(x1, x1);
  path.lineTo(x1, 0);
  path.lineTo(x2, 0);
  path.lineTo(x2, x1);
  path.lineTo(w, x1);
  path.lineTo(w, y2);
  path.lineTo(x2, y2);
  path.lineTo(x2, h);
  path.lineTo(x1, h);
  path.lineTo(x1, y2);
  path.lineTo(0, y2);
  path.closePath();
  return path;
};

// Handle paints at the LEFT edge of the vertical arm — the OOXML
// inset `x1 = ss*adj/100000` (ahXY pos x="x1" y="t"). Dragging
// rightward widens the inset (thinner arms); leftward → wider arms.
// Inverse: adj = x1 / ss * 100000.
export const PLUS_HANDLES: readonly AdjustmentHandle[] = [
  linearTopEdgeHandle({
    forward: (adj, { w, h }) => (adj / 100000) * Math.min(w, h),
    inverse: (x, { w, h }) => (x / Math.min(w, h)) * 100000,
    spec: PLUS_ADJUSTMENTS[0],
  }),
];
