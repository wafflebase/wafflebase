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
 * `corner` — L-shape covering the SW corner of the frame. Bottom
 * arm has thickness `adj1` (horizontal strip along the bottom);
 * left arm has thickness `adj2` (vertical strip along the left
 * side). Visually distinct from `halfFrame` by orientation.
 */
export const CORNER_ADJUSTMENTS: readonly AdjustmentSpec[] = [
  {
    name: 'Bottom arm thickness',
    defaultValue: 33333,
    min: 0,
    max: 100000,
    axisLabel: 'bottom',
  },
  {
    name: 'Left arm thickness',
    defaultValue: 33333,
    min: 0,
    max: 100000,
    axisLabel: 'left',
  },
];

export const buildCorner: PathBuilder = ({ w, h }, adjustments) => {
  const a1 = adj(adjustments, 0, CORNER_ADJUSTMENTS[0].defaultValue);
  const a2 = adj(adjustments, 1, CORNER_ADJUSTMENTS[1].defaultValue);
  const t1 = (a1 / 100000) * h;
  const t2 = (a2 / 100000) * w;
  const path = new Path2D();
  // L-shape: left arm + bottom arm meeting at SW corner.
  path.moveTo(0, 0);
  path.lineTo(t2, 0);
  path.lineTo(t2, h - t1);
  path.lineTo(w, h - t1);
  path.lineTo(w, h);
  path.lineTo(0, h);
  path.closePath();
  return path;
};

export const CORNER_HANDLES: readonly AdjustmentHandle[] = [
  // Bottom-arm thickness: diamond on the right edge — drag up
  // increases t1. forward returns y = h - t1; inverse: t1 = h - y.
  linearLeftEdgeHandle({
    forward: (a, { h }) => h - (a / 100000) * h,
    inverse: (y, { h }) => ((h - y) / h) * 100000,
    spec: CORNER_ADJUSTMENTS[0],
    index: 0,
  }),
  // Left-arm thickness: diamond on the top edge at x = t2.
  linearTopEdgeHandle({
    forward: (a, { w }) => (a / 100000) * w,
    inverse: (x, { w }) => (x / w) * 100000,
    spec: CORNER_ADJUSTMENTS[1],
    index: 1,
  }),
];
