import type {
  AdjustmentHandle,
  AdjustmentSpec,
  PathBuilder,
} from '../builder';
import { adj } from '../builder';
import { linearTopEdgeHandle } from '../handles';

/**
 * `plaque` — rectangle with concave-cut corners. `adj1` is the
 * corner-notch depth as a fraction of `min(w, h)`. V0 renders the
 * cut as a straight chamfer (45° polygon corner). The OOXML preset
 * uses arc-cut corners — that's a follow-up refinement once
 * `polylineArc` is exercised across more shapes.
 */
export const PLAQUE_ADJUSTMENTS: readonly AdjustmentSpec[] = [
  {
    name: 'Corner notch',
    defaultValue: 16667,
    min: 0,
    max: 50000,
  },
];

export const buildPlaque: PathBuilder = ({ w, h }, adjustments) => {
  const a1 = adj(adjustments, 0, PLAQUE_ADJUSTMENTS[0].defaultValue);
  const c = (a1 / 100000) * Math.min(w, h);
  const path = new Path2D();
  path.moveTo(c, 0);
  path.lineTo(w - c, 0);
  path.lineTo(w, c);
  path.lineTo(w, h - c);
  path.lineTo(w - c, h);
  path.lineTo(c, h);
  path.lineTo(0, h - c);
  path.lineTo(0, c);
  path.closePath();
  return path;
};

export const PLAQUE_HANDLES: readonly AdjustmentHandle[] = [
  linearTopEdgeHandle({
    forward: (a, { w, h }) => (a / 100000) * Math.min(w, h),
    inverse: (x, { w, h }) => (x / Math.min(w, h)) * 100000,
    spec: PLAQUE_ADJUSTMENTS[0],
  }),
];
