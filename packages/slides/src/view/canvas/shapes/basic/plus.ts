import type { PathBuilder, AdjustmentSpec, AdjustmentHandle } from '../builder';
import { adj } from '../builder';
import { linearTopEdgeHandle } from '../handles';

/**
 * `plus` — cross / plus sign filling the frame.
 *
 * Adjustments:
 *   [0] armThickness — OOXML thousandths of `min(w,h)`; default 25000.
 */
export const PLUS_ADJUSTMENTS: readonly AdjustmentSpec[] = [
  { name: 'Arm thickness', defaultValue: 25000, min: 0, max: 50000 },
];

export const buildPlus: PathBuilder = ({ w, h }, adjustments) => {
  const t = (adj(adjustments, 0, 25000) / 100000) * Math.min(w, h);
  const xL = (w - t) / 2;
  const xR = (w + t) / 2;
  const yT = (h - t) / 2;
  const yB = (h + t) / 2;
  const path = new Path2D();
  path.moveTo(xL, 0);
  path.lineTo(xR, 0);
  path.lineTo(xR, yT);
  path.lineTo(w, yT);
  path.lineTo(w, yB);
  path.lineTo(xR, yB);
  path.lineTo(xR, h);
  path.lineTo(xL, h);
  path.lineTo(xL, yB);
  path.lineTo(0, yB);
  path.lineTo(0, yT);
  path.lineTo(xL, yT);
  path.closePath();
  return path;
};

// Handle paints at the LEFT edge of the vertical arm (xL = (w-t)/2).
// As the user drags rightward, the arm narrows; leftward → wider.
// Inverse: t = w - 2*pointer.x ⇒ adj = (t / min(w,h)) * 100000.
export const PLUS_HANDLES: readonly AdjustmentHandle[] = [
  linearTopEdgeHandle({
    forward: (adj, { w, h }) => {
      const t = (adj / 100000) * Math.min(w, h);
      return (w - t) / 2;
    },
    inverse: (x, { w, h }) => {
      const t = w - 2 * x;
      return (t / Math.min(w, h)) * 100000;
    },
    spec: PLUS_ADJUSTMENTS[0],
  }),
];
