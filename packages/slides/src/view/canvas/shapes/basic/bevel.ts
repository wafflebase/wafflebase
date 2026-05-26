import type {
  AdjustmentHandle,
  AdjustmentSpec,
  PathBuilder,
} from '../builder';
import { adj } from '../builder';
import { linearTopEdgeHandle } from '../handles';

/**
 * `bevel` — rectangle with a visible bevel inset on all four sides.
 * Path = outer rectangle CW + inner inset rectangle CW + diagonals
 * from each outer corner to the matching inner corner, producing
 * four trapezoidal sub-paths. Filled with non-zero winding so the
 * bevel "frame" shows as a single closed region around an
 * unfilled inner. Visual highlight gradient (raised-button look)
 * is a P3-C follow-up.
 */
export const BEVEL_ADJUSTMENTS: readonly AdjustmentSpec[] = [
  {
    name: 'Bevel size',
    defaultValue: 12500,
    min: 0,
    max: 50000,
  },
];

export const buildBevel: PathBuilder = ({ w, h }, adjustments) => {
  const a1 = adj(adjustments, 0, BEVEL_ADJUSTMENTS[0].defaultValue);
  const t = (a1 / 100000) * Math.min(w, h);
  const path = new Path2D();
  // Outer rect CW.
  path.moveTo(0, 0);
  path.lineTo(w, 0);
  path.lineTo(w, h);
  path.lineTo(0, h);
  path.closePath();
  // Inner inset CCW — net zero winding inside → unfilled centre.
  path.moveTo(t, t);
  path.lineTo(t, h - t);
  path.lineTo(w - t, h - t);
  path.lineTo(w - t, t);
  path.closePath();
  return path;
};

export const BEVEL_HANDLES: readonly AdjustmentHandle[] = [
  linearTopEdgeHandle({
    forward: (a, { w, h }) => (a / 100000) * Math.min(w, h),
    inverse: (x, { w, h }) => (x / Math.min(w, h)) * 100000,
    spec: BEVEL_ADJUSTMENTS[0],
  }),
];
