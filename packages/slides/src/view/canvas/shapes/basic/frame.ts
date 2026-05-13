import type {
  AdjustmentHandle,
  AdjustmentSpec,
  PathBuilder,
} from '../builder';
import { adj } from '../builder';
import { linearTopEdgeHandle } from '../handles';

/**
 * `frame` — hollow rectangle with adjustable border thickness.
 * Inner rectangle is wound CCW so non-zero winding fill leaves the
 * interior unfilled. `adj1` is the border thickness in OOXML
 * thousandths of `min(w, h)`.
 */
export const FRAME_ADJUSTMENTS: readonly AdjustmentSpec[] = [
  {
    name: 'Border thickness',
    defaultValue: 12500,
    min: 0,
    max: 50000,
  },
];

export const buildFrame: PathBuilder = ({ w, h }, adjustments) => {
  const a1 = adj(adjustments, 0, FRAME_ADJUSTMENTS[0].defaultValue);
  const t = (a1 / 100000) * Math.min(w, h);
  const path = new Path2D();
  // Outer CW
  path.moveTo(0, 0);
  path.lineTo(w, 0);
  path.lineTo(w, h);
  path.lineTo(0, h);
  path.closePath();
  // Inner CCW — net winding 0 inside, leaving a hole.
  path.moveTo(t, t);
  path.lineTo(t, h - t);
  path.lineTo(w - t, h - t);
  path.lineTo(w - t, t);
  path.closePath();
  return path;
};

export const FRAME_HANDLES: readonly AdjustmentHandle[] = [
  linearTopEdgeHandle({
    forward: (a, { w, h }) => (a / 100000) * Math.min(w, h),
    inverse: (x, { w, h }) => (x / Math.min(w, h)) * 100000,
    spec: FRAME_ADJUSTMENTS[0],
  }),
];
