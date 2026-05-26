import type {
  AdjustmentHandle,
  AdjustmentSpec,
  PathBuilder,
} from '../builder';
import { adj } from '../builder';
import { linearTopEdgeHandle } from '../handles';

/**
 * `foldedCorner` — rectangle with the NE corner visibly folded
 * inward, exposing a triangular fold. `adj1` is the fold size as a
 * fraction of `min(w, h)`. Path includes both the main outline
 * (with the folded corner missing) and the fold triangle itself
 * for a single combined fill region.
 */
export const FOLDED_CORNER_ADJUSTMENTS: readonly AdjustmentSpec[] = [
  {
    name: 'Fold size',
    defaultValue: 16667,
    min: 0,
    max: 50000,
  },
];

export const buildFoldedCorner: PathBuilder = ({ w, h }, adjustments) => {
  const a1 = adj(adjustments, 0, FOLDED_CORNER_ADJUSTMENTS[0].defaultValue);
  const f = (a1 / 100000) * Math.min(w, h);
  const path = new Path2D();
  // Main outline: rectangle missing the NE corner triangle.
  path.moveTo(0, 0);
  path.lineTo(w - f, 0);
  path.lineTo(w, f);
  path.lineTo(w, h);
  path.lineTo(0, h);
  path.closePath();
  // Fold triangle painted as a separate subpath inside the NE
  // corner — visually distinct via the dispatcher's edge stroke.
  path.moveTo(w - f, 0);
  path.lineTo(w - f, f);
  path.lineTo(w, f);
  path.closePath();
  return path;
};

export const FOLDED_CORNER_HANDLES: readonly AdjustmentHandle[] = [
  // Diamond sits on the top edge — drag left to grow the fold.
  // The fold corner is at x = w - f; forward maps adj → (w - f),
  // inverse: f = w - x → adj = ((w - x) / min(w,h)) * 100000.
  linearTopEdgeHandle({
    forward: (a, { w, h }) => w - (a / 100000) * Math.min(w, h),
    inverse: (x, { w, h }) => ((w - x) / Math.min(w, h)) * 100000,
    spec: FOLDED_CORNER_ADJUSTMENTS[0],
  }),
];
