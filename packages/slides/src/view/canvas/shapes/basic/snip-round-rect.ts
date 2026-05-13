import type {
  AdjustmentHandle,
  AdjustmentSpec,
  PathBuilder,
} from '../builder';
import { adj } from '../builder';
import { polylineArc } from '../curves';
import {
  linearLeftEdgeHandle,
  linearTopEdgeHandle,
} from '../handles';

/**
 * `snipRoundRect` — rectangle with NE corner chamfered (straight
 * snip) and SW corner rounded (quarter arc). `adj1` = NE snip
 * size, `adj2` = SW round radius.
 */
export const SNIP_ROUND_RECT_ADJUSTMENTS: readonly AdjustmentSpec[] = [
  {
    name: 'NE corner snip',
    defaultValue: 12500,
    min: 0,
    max: 50000,
    axisLabel: 'ne',
  },
  {
    name: 'SW corner radius',
    defaultValue: 16667,
    min: 0,
    max: 50000,
    axisLabel: 'sw',
  },
];

export const buildSnipRoundRect: PathBuilder = ({ w, h }, adjustments) => {
  const a1 = adj(adjustments, 0, SNIP_ROUND_RECT_ADJUSTMENTS[0].defaultValue);
  const a2 = adj(adjustments, 1, SNIP_ROUND_RECT_ADJUSTMENTS[1].defaultValue);
  const cNe = (a1 / 100000) * Math.min(w, h);
  const rSw = (a2 / 100000) * Math.min(w, h);
  const path = new Path2D();
  path.moveTo(0, 0);
  path.lineTo(w - cNe, 0);
  path.lineTo(w, cNe);
  path.lineTo(w, h);
  path.lineTo(rSw, h);
  const sw = polylineArc(rSw, h - rSw, rSw, rSw, Math.PI / 2, Math.PI, 8);
  for (const p of sw) path.lineTo(p.x, p.y);
  path.closePath();
  return path;
};

export const SNIP_ROUND_RECT_HANDLES: readonly AdjustmentHandle[] = [
  linearTopEdgeHandle({
    forward: (val, { w, h }) => w - (val / 100000) * Math.min(w, h),
    inverse: (x, { w, h }) => ((w - x) / Math.min(w, h)) * 100000,
    spec: SNIP_ROUND_RECT_ADJUSTMENTS[0],
    index: 0,
  }),
  linearLeftEdgeHandle({
    forward: (val, { w, h }) => h - (val / 100000) * Math.min(w, h),
    inverse: (y, { w, h }) => ((h - y) / Math.min(w, h)) * 100000,
    spec: SNIP_ROUND_RECT_ADJUSTMENTS[1],
    index: 1,
  }),
];
