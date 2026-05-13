import type {
  AdjustmentHandle,
  AdjustmentSpec,
  PathBuilder,
} from '../builder';
import { adj } from '../builder';
import { linearTopEdgeHandle } from '../handles';

/**
 * `snip2SameRect` — rectangle with the two TOP corners chamfered.
 * `adj1` is the NW chamfer size, `adj2` is the NE chamfer size,
 * both as fractions of `min(w, h)`.
 */
export const SNIP2_SAME_RECT_ADJUSTMENTS: readonly AdjustmentSpec[] = [
  {
    name: 'NW corner cut',
    defaultValue: 12500,
    min: 0,
    max: 50000,
    axisLabel: 'nw',
  },
  {
    name: 'NE corner cut',
    defaultValue: 12500,
    min: 0,
    max: 50000,
    axisLabel: 'ne',
  },
];

export const buildSnip2SameRect: PathBuilder = ({ w, h }, adjustments) => {
  const a1 = adj(adjustments, 0, SNIP2_SAME_RECT_ADJUSTMENTS[0].defaultValue);
  const a2 = adj(adjustments, 1, SNIP2_SAME_RECT_ADJUSTMENTS[1].defaultValue);
  const c1 = (a1 / 100000) * Math.min(w, h);
  const c2 = (a2 / 100000) * Math.min(w, h);
  const path = new Path2D();
  path.moveTo(c1, 0);
  path.lineTo(w - c2, 0);
  path.lineTo(w, c2);
  path.lineTo(w, h);
  path.lineTo(0, h);
  path.lineTo(0, c1);
  path.closePath();
  return path;
};

export const SNIP2_SAME_RECT_HANDLES: readonly AdjustmentHandle[] = [
  linearTopEdgeHandle({
    forward: (val, { w, h }) => (val / 100000) * Math.min(w, h),
    inverse: (x, { w, h }) => (x / Math.min(w, h)) * 100000,
    spec: SNIP2_SAME_RECT_ADJUSTMENTS[0],
    index: 0,
  }),
  linearTopEdgeHandle({
    forward: (val, { w, h }) => w - (val / 100000) * Math.min(w, h),
    inverse: (x, { w, h }) => ((w - x) / Math.min(w, h)) * 100000,
    spec: SNIP2_SAME_RECT_ADJUSTMENTS[1],
    index: 1,
  }),
];
