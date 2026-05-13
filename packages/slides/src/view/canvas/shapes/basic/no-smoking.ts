import type {
  AdjustmentHandle,
  AdjustmentSpec,
  PathBuilder,
} from '../builder';
import { adj } from '../builder';
import { polylineArc } from '../curves';
import { linearTopEdgeHandle } from '../handles';

/**
 * `noSmoking` — circle (outer ring) with a diagonal NW→SE slash.
 * `adj1` is the ring thickness as a fraction of `min(w, h)`. V0
 * uses a thick polygon slash; the OOXML preset's exact band-corner
 * geometry is a follow-up refinement.
 */
export const NO_SMOKING_ADJUSTMENTS: readonly AdjustmentSpec[] = [
  {
    name: 'Band thickness',
    defaultValue: 18750,
    min: 0,
    max: 50000,
  },
];

export const buildNoSmoking: PathBuilder = ({ w, h }, adjustments) => {
  const a = adj(adjustments, 0, NO_SMOKING_ADJUSTMENTS[0].defaultValue);
  const t = (a / 100000) * Math.min(w, h);
  const cx = w / 2;
  const cy = h / 2;
  const rx = w / 2;
  const ry = h / 2;
  const innerScale = 1 - (2 * t) / Math.min(w, h);
  const irx = rx * Math.max(0, innerScale);
  const iry = ry * Math.max(0, innerScale);
  const path = new Path2D();
  // Outer ring CW.
  const outer = polylineArc(cx, cy, rx, ry, 0, 2 * Math.PI, 32);
  path.moveTo(outer[0].x, outer[0].y);
  for (let i = 1; i < outer.length; i++) {
    path.lineTo(outer[i].x, outer[i].y);
  }
  path.closePath();
  // Inner CCW (hole) — leaves a ring.
  const inner = polylineArc(cx, cy, irx, iry, 2 * Math.PI, 0, 32);
  path.moveTo(inner[0].x, inner[0].y);
  for (let i = 1; i < inner.length; i++) {
    path.lineTo(inner[i].x, inner[i].y);
  }
  path.closePath();
  // Diagonal slash NW → SE — a thick band the same thickness as the
  // ring. Painted as a separate CW subpath: under non-zero winding
  // it merges with the ring; under even-odd it shows up either way.
  const half = t / Math.SQRT2;
  path.moveTo(half, -half);
  path.lineTo(w + half, h - half);
  path.lineTo(w - half, h + half);
  path.lineTo(-half, half);
  path.closePath();
  return path;
};

export const NO_SMOKING_HANDLES: readonly AdjustmentHandle[] = [
  linearTopEdgeHandle({
    forward: (val, { w, h }) => (val / 100000) * Math.min(w, h),
    inverse: (x, { w, h }) => (x / Math.min(w, h)) * 100000,
    spec: NO_SMOKING_ADJUSTMENTS[0],
  }),
];
