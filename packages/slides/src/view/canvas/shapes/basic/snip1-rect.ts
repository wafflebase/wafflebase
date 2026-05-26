import type {
  AdjustmentHandle,
  AdjustmentSpec,
  PathBuilder,
} from '../builder';
import { adj } from '../builder';
import { linearTopEdgeHandle } from '../handles';

/**
 * `snip1Rect` — rectangle with the NE corner replaced by a straight
 * 45° chamfer. `adj1` is the chamfer size as a fraction of
 * `min(w, h)`. OOXML preset default 12500.
 */
export const SNIP1_RECT_ADJUSTMENTS: readonly AdjustmentSpec[] = [
  {
    name: 'NE corner cut',
    defaultValue: 12500,
    min: 0,
    max: 50000,
  },
];

export const buildSnip1Rect: PathBuilder = ({ w, h }, adjustments) => {
  const a = adj(adjustments, 0, SNIP1_RECT_ADJUSTMENTS[0].defaultValue);
  const c = (a / 100000) * Math.min(w, h);
  const path = new Path2D();
  path.moveTo(0, 0);
  path.lineTo(w - c, 0);
  path.lineTo(w, c);
  path.lineTo(w, h);
  path.lineTo(0, h);
  path.closePath();
  return path;
};

export const SNIP1_RECT_HANDLES: readonly AdjustmentHandle[] = [
  linearTopEdgeHandle({
    forward: (val, { w, h }) => w - (val / 100000) * Math.min(w, h),
    inverse: (x, { w, h }) => ((w - x) / Math.min(w, h)) * 100000,
    spec: SNIP1_RECT_ADJUSTMENTS[0],
  }),
];
