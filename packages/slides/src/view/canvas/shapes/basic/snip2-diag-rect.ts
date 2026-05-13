import type {
  AdjustmentHandle,
  AdjustmentSpec,
  PathBuilder,
} from '../builder';
import { adj } from '../builder';
import {
  linearLeftEdgeHandle,
  linearTopEdgeHandle,
} from '../handles';

/**
 * `snip2DiagRect` — rectangle with NE and SW corners chamfered
 * (opposite diagonals). `adj1` is the NE chamfer size, `adj2` is
 * the SW chamfer size.
 */
export const SNIP2_DIAG_RECT_ADJUSTMENTS: readonly AdjustmentSpec[] = [
  {
    name: 'NE corner cut',
    defaultValue: 12500,
    min: 0,
    max: 50000,
    axisLabel: 'ne',
  },
  {
    name: 'SW corner cut',
    defaultValue: 12500,
    min: 0,
    max: 50000,
    axisLabel: 'sw',
  },
];

export const buildSnip2DiagRect: PathBuilder = ({ w, h }, adjustments) => {
  const a1 = adj(adjustments, 0, SNIP2_DIAG_RECT_ADJUSTMENTS[0].defaultValue);
  const a2 = adj(adjustments, 1, SNIP2_DIAG_RECT_ADJUSTMENTS[1].defaultValue);
  const cNe = (a1 / 100000) * Math.min(w, h);
  const cSw = (a2 / 100000) * Math.min(w, h);
  const path = new Path2D();
  path.moveTo(0, 0);
  path.lineTo(w - cNe, 0);
  path.lineTo(w, cNe);
  path.lineTo(w, h);
  path.lineTo(cSw, h);
  path.lineTo(0, h - cSw);
  path.closePath();
  return path;
};

export const SNIP2_DIAG_RECT_HANDLES: readonly AdjustmentHandle[] = [
  // NE chamfer: top-edge handle at x = w - cNe.
  linearTopEdgeHandle({
    forward: (val, { w, h }) => w - (val / 100000) * Math.min(w, h),
    inverse: (x, { w, h }) => ((w - x) / Math.min(w, h)) * 100000,
    spec: SNIP2_DIAG_RECT_ADJUSTMENTS[0],
    index: 0,
  }),
  // SW chamfer: left-edge handle at y = h - cSw.
  linearLeftEdgeHandle({
    forward: (val, { w, h }) => h - (val / 100000) * Math.min(w, h),
    inverse: (y, { w, h }) => ((h - y) / Math.min(w, h)) * 100000,
    spec: SNIP2_DIAG_RECT_ADJUSTMENTS[1],
    index: 1,
  }),
];
