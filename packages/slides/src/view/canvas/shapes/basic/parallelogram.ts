import type { PathBuilder, AdjustmentSpec, AdjustmentHandle } from '../builder';
import { adj } from '../builder';
import { linearTopEdgeHandle } from '../handles';

/**
 * `parallelogram` — quadrilateral with two horizontal sides and two
 * slanted sides.
 *
 * Adjustments:
 *   [0] slant — top-left horizontal offset as OOXML thousandths of `w`;
 *       default 25000 (25%).
 */
export const PARALLELOGRAM_ADJUSTMENTS: readonly AdjustmentSpec[] = [
  { name: 'Slant', defaultValue: 25000, min: 0, max: 100000 },
];

export const buildParallelogram: PathBuilder = ({ w, h }, adjustments) => {
  const slant = (adj(adjustments, 0, 25000) / 100000) * w;
  const path = new Path2D();
  path.moveTo(slant, 0);
  path.lineTo(w, 0);
  path.lineTo(w - slant, h);
  path.lineTo(0, h);
  path.closePath();
  return path;
};

export const PARALLELOGRAM_HANDLES: readonly AdjustmentHandle[] = [
  linearTopEdgeHandle({
    forward: (adj, { w }) => (adj / 100000) * w,
    inverse: (x, { w }) => (x / w) * 100000,
    spec: PARALLELOGRAM_ADJUSTMENTS[0],
  }),
];
