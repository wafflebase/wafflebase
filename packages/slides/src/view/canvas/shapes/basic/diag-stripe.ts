import type {
  AdjustmentHandle,
  AdjustmentSpec,
  PathBuilder,
} from '../builder';
import { adj } from '../builder';
import { linearTopEdgeHandle } from '../handles';

/**
 * `diagStripe` — V0 approximation: triangular wedge from the NW
 * corner along both axes. `adj1` controls how far the wedge
 * extends as a fraction of width/height. Refining toward OOXML's
 * parallelogram-stripe semantics is a follow-up; the V0 path is
 * enough for picker insertion and a recognisable visual.
 */
export const DIAG_STRIPE_ADJUSTMENTS: readonly AdjustmentSpec[] = [
  {
    name: 'Stripe thickness',
    defaultValue: 50000,
    min: 0,
    max: 100000,
  },
];

export const buildDiagStripe: PathBuilder = ({ w, h }, adjustments) => {
  const a1 = adj(adjustments, 0, DIAG_STRIPE_ADJUSTMENTS[0].defaultValue);
  const frac = a1 / 100000;
  const path = new Path2D();
  path.moveTo(0, 0);
  path.lineTo(w * frac, 0);
  path.lineTo(0, h * frac);
  path.closePath();
  return path;
};

export const DIAG_STRIPE_HANDLES: readonly AdjustmentHandle[] = [
  linearTopEdgeHandle({
    forward: (a, { w }) => (a / 100000) * w,
    inverse: (x, { w }) => (x / w) * 100000,
    spec: DIAG_STRIPE_ADJUSTMENTS[0],
  }),
];
