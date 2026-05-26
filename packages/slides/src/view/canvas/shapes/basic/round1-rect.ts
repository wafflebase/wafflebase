import type {
  AdjustmentHandle,
  AdjustmentSpec,
  PathBuilder,
} from '../builder';
import { adj } from '../builder';
import { polylineArc } from '../curves';
import { linearTopEdgeHandle } from '../handles';

/**
 * `round1Rect` — rectangle with the NE corner replaced by a
 * quarter-circle round. `adj1` is the radius as a fraction of
 * `min(w, h)`. OOXML preset default ~16667.
 */
export const ROUND1_RECT_ADJUSTMENTS: readonly AdjustmentSpec[] = [
  {
    name: 'NE corner radius',
    defaultValue: 16667,
    min: 0,
    max: 50000,
  },
];

export const buildRound1Rect: PathBuilder = ({ w, h }, adjustments) => {
  const a = adj(adjustments, 0, ROUND1_RECT_ADJUSTMENTS[0].defaultValue);
  const r = (a / 100000) * Math.min(w, h);
  const path = new Path2D();
  path.moveTo(0, 0);
  path.lineTo(w - r, 0);
  // Quarter arc centred at (w-r, r), from top tangent to right tangent.
  const arc = polylineArc(w - r, r, r, r, -Math.PI / 2, 0, 8);
  for (const p of arc) path.lineTo(p.x, p.y);
  path.lineTo(w, h);
  path.lineTo(0, h);
  path.closePath();
  return path;
};

export const ROUND1_RECT_HANDLES: readonly AdjustmentHandle[] = [
  linearTopEdgeHandle({
    forward: (val, { w, h }) => w - (val / 100000) * Math.min(w, h),
    inverse: (x, { w, h }) => ((w - x) / Math.min(w, h)) * 100000,
    spec: ROUND1_RECT_ADJUSTMENTS[0],
  }),
];
