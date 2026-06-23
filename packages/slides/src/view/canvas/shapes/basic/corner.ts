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
  // OOXML: both arm thicknesses scale by ss = min(w,h), not by the
  // owning axis. dy1 = ss*a1/100000 (bottom arm), x1 = ss*a2/100000
  // (left arm). y1 = b - dy1.
  const ss = Math.min(w, h);
  const dy1 = (a1 / 100000) * ss; // bottom arm thickness
  const x1 = (a2 / 100000) * ss; // left arm width
  const y1 = h - dy1;
  const path = new Path2D();
  // L-shape: left arm + bottom arm meeting at SW corner.
  path.moveTo(0, 0);
  path.lineTo(x1, 0);
  path.lineTo(x1, y1);
  path.lineTo(w, y1);
  path.lineTo(w, h);
  path.lineTo(0, h);
  path.closePath();
  return path;
};

export const CORNER_HANDLES: readonly AdjustmentHandle[] = [
  // Bottom-arm thickness: diamond on the left edge — drag up
  // increases dy1. forward returns y1 = h - ss*a1/100000; inverse:
  // a1 = (h - y) / ss * 100000.
  linearLeftEdgeHandle({
    forward: (a, { w, h }) => h - (a / 100000) * Math.min(w, h),
    inverse: (y, { w, h }) => ((h - y) / Math.min(w, h)) * 100000,
    spec: CORNER_ADJUSTMENTS[0],
    index: 0,
  }),
  // Left-arm width: diamond on the top edge at x1 = ss*a2/100000.
  linearTopEdgeHandle({
    forward: (a, { w, h }) => (a / 100000) * Math.min(w, h),
    inverse: (x, { w, h }) => (x / Math.min(w, h)) * 100000,
    spec: CORNER_ADJUSTMENTS[1],
    index: 1,
  }),
];
