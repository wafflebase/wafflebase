import type {
  AdjustmentHandle,
  AdjustmentSpec,
  PathBuilder,
} from '../builder';
import { adj } from '../builder';
import { polylineArc } from '../curves';
import { linearTopEdgeHandle } from '../handles';

/**
 * `round2SameRect` — rectangle with both TOP corners rounded.
 * `adj1` is the NW radius, `adj2` is the NE radius.
 */
export const ROUND2_SAME_RECT_ADJUSTMENTS: readonly AdjustmentSpec[] = [
  {
    name: 'NW corner radius',
    defaultValue: 16667,
    min: 0,
    max: 50000,
    axisLabel: 'nw',
  },
  {
    name: 'NE corner radius',
    defaultValue: 16667,
    min: 0,
    max: 50000,
    axisLabel: 'ne',
  },
];

export const buildRound2SameRect: PathBuilder = ({ w, h }, adjustments) => {
  const a1 = adj(adjustments, 0, ROUND2_SAME_RECT_ADJUSTMENTS[0].defaultValue);
  const a2 = adj(adjustments, 1, ROUND2_SAME_RECT_ADJUSTMENTS[1].defaultValue);
  const r1 = (a1 / 100000) * Math.min(w, h);
  const r2 = (a2 / 100000) * Math.min(w, h);
  const path = new Path2D();
  // NW rounded corner starts at (0, r1) → arc → (r1, 0).
  path.moveTo(0, r1);
  const nw = polylineArc(r1, r1, r1, r1, Math.PI, (3 * Math.PI) / 2, 8);
  for (const p of nw) path.lineTo(p.x, p.y);
  path.lineTo(w - r2, 0);
  // NE rounded corner.
  const ne = polylineArc(w - r2, r2, r2, r2, -Math.PI / 2, 0, 8);
  for (const p of ne) path.lineTo(p.x, p.y);
  path.lineTo(w, h);
  path.lineTo(0, h);
  path.closePath();
  return path;
};

export const ROUND2_SAME_RECT_HANDLES: readonly AdjustmentHandle[] = [
  linearTopEdgeHandle({
    forward: (val, { w, h }) => (val / 100000) * Math.min(w, h),
    inverse: (x, { w, h }) => (x / Math.min(w, h)) * 100000,
    spec: ROUND2_SAME_RECT_ADJUSTMENTS[0],
    index: 0,
  }),
  linearTopEdgeHandle({
    forward: (val, { w, h }) => w - (val / 100000) * Math.min(w, h),
    inverse: (x, { w, h }) => ((w - x) / Math.min(w, h)) * 100000,
    spec: ROUND2_SAME_RECT_ADJUSTMENTS[1],
    index: 1,
  }),
];
