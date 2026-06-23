import type { AdjustmentHandle, AdjustmentSpec, PathBuilder } from '../builder';
import { adj } from '../builder';
import { linearTopEdgeHandle } from '../handles';

/**
 * `plaque` — rectangle whose four corners are cut by concave
 * quarter-circles. `adj1` is the corner-notch depth as a fraction of
 * `min(w, h)`. Matching the OOXML `plaque` preset, each corner arc is
 * centered at the rectangle corner with radius `x1 = ss·adj/100000`
 * and sweeps -90° (`swAng = -5400000`), curving inward.
 */
export const PLAQUE_ADJUSTMENTS: readonly AdjustmentSpec[] = [
  {
    name: 'Corner notch',
    defaultValue: 16667,
    min: 0,
    max: 50000,
  },
];

export const buildPlaque: PathBuilder = ({ w, h }, adjustments) => {
  const a1 = adj(adjustments, 0, PLAQUE_ADJUSTMENTS[0].defaultValue);
  // x1 = ss · adj / 100000 (radius of each concave corner arc).
  const r = (a1 / 100000) * Math.min(w, h);
  const path = new Path2D();
  // Each corner arc is centered at the rectangle corner and sweeps -90°
  // (OOXML swAng = -5400000), so canvas angles decrease → counterclockwise.
  // Start on the left edge, x1 down from the top-left corner.
  path.moveTo(0, r);
  // Top-left: center (0,0), 90° → 0°.
  path.arc(0, 0, r, Math.PI / 2, 0, true);
  path.lineTo(w - r, 0);
  // Top-right: center (w,0), 180° → 90°.
  path.arc(w, 0, r, Math.PI, Math.PI / 2, true);
  path.lineTo(w, h - r);
  // Bottom-right: center (w,h), 270° → 180°.
  path.arc(w, h, r, (3 * Math.PI) / 2, Math.PI, true);
  path.lineTo(r, h);
  // Bottom-left: center (0,h), 0° → -90°.
  path.arc(0, h, r, 0, -Math.PI / 2, true);
  path.closePath();
  return path;
};

export const PLAQUE_HANDLES: readonly AdjustmentHandle[] = [
  linearTopEdgeHandle({
    forward: (a, { w, h }) => (a / 100000) * Math.min(w, h),
    inverse: (x, { w, h }) => (x / Math.min(w, h)) * 100000,
    spec: PLAQUE_ADJUSTMENTS[0],
  }),
];
