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
 * `round2DiagRect` — rectangle with NE and SW corners rounded
 * (opposite diagonals). `adj1` = NE radius, `adj2` = SW radius.
 */
export const ROUND2_DIAG_RECT_ADJUSTMENTS: readonly AdjustmentSpec[] = [
  {
    name: 'NE corner radius',
    defaultValue: 16667,
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

export const buildRound2DiagRect: PathBuilder = ({ w, h }, adjustments) => {
  const a1 = adj(adjustments, 0, ROUND2_DIAG_RECT_ADJUSTMENTS[0].defaultValue);
  const a2 = adj(adjustments, 1, ROUND2_DIAG_RECT_ADJUSTMENTS[1].defaultValue);
  const rNe = (a1 / 100000) * Math.min(w, h);
  const rSw = (a2 / 100000) * Math.min(w, h);
  const path = new Path2D();
  path.moveTo(0, 0);
  path.lineTo(w - rNe, 0);
  const ne = polylineArc(w - rNe, rNe, rNe, rNe, -Math.PI / 2, 0, 8);
  for (const p of ne) path.lineTo(p.x, p.y);
  path.lineTo(w, h);
  path.lineTo(rSw, h);
  const sw = polylineArc(rSw, h - rSw, rSw, rSw, Math.PI / 2, Math.PI, 8);
  for (const p of sw) path.lineTo(p.x, p.y);
  path.closePath();
  return path;
};

export const ROUND2_DIAG_RECT_HANDLES: readonly AdjustmentHandle[] = [
  linearTopEdgeHandle({
    forward: (val, { w, h }) => w - (val / 100000) * Math.min(w, h),
    inverse: (x, { w, h }) => ((w - x) / Math.min(w, h)) * 100000,
    spec: ROUND2_DIAG_RECT_ADJUSTMENTS[0],
    index: 0,
  }),
  linearLeftEdgeHandle({
    forward: (val, { w, h }) => h - (val / 100000) * Math.min(w, h),
    inverse: (y, { w, h }) => ((h - y) / Math.min(w, h)) * 100000,
    spec: ROUND2_DIAG_RECT_ADJUSTMENTS[1],
    index: 1,
  }),
];
