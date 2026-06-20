import type {
  AdjustmentHandle,
  AdjustmentSpec,
  PathBuilder,
} from '../builder';
import { adj } from '../builder';
import { linearTopEdgeHandle } from '../handles';

/**
 * `diagStripe` — a diagonal band running from the top edge down to the
 * bottom-left, faithful to the OOXML preset. The stripe's upper-left
 * edge runs `(0, y2) → (x2, 0)`; its lower-right edge is the main
 * diagonal `(w, 0) → (0, h)`. `adj1` (`a`, default 50000) sets the
 * offset `x2 = w·a/100000`, `y2 = h·a/100000` — i.e. the band width.
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
  const a1 = Math.max(
    0,
    Math.min(100000, adj(adjustments, 0, DIAG_STRIPE_ADJUSTMENTS[0].defaultValue)),
  );
  const x2 = (a1 / 100000) * w;
  const y2 = (a1 / 100000) * h;
  const path = new Path2D();
  path.moveTo(0, y2);
  path.lineTo(x2, 0);
  path.lineTo(w, 0);
  path.lineTo(0, h);
  path.closePath();
  return path;
};

export const DIAG_STRIPE_HANDLES: readonly AdjustmentHandle[] = [
  linearTopEdgeHandle({
    forward: (a, { w }) => (a / 100000) * w,
    inverse: (x, { w }) => (w > 0 ? (x / w) * 100000 : 0),
    spec: DIAG_STRIPE_ADJUSTMENTS[0],
  }),
];
