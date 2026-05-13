import type {
  AdjustmentHandle,
  AdjustmentSpec,
  PathBuilder,
} from '../builder';
import { adj } from '../builder';
import { linearTopEdgeHandle } from '../handles';

/**
 * `cube` — 2D projection of a cube. `adj1` controls the depth as a
 * fraction of `min(w, h)`. Three faces (front, top, right) are
 * painted as separate sub-paths so the dispatcher's single
 * fill/stroke pass renders them as a unified silhouette.
 */
export const CUBE_ADJUSTMENTS: readonly AdjustmentSpec[] = [
  {
    name: 'Depth',
    defaultValue: 25000,
    min: 0,
    max: 50000,
  },
];

export const buildCube: PathBuilder = ({ w, h }, adjustments) => {
  const a1 = adj(adjustments, 0, CUBE_ADJUSTMENTS[0].defaultValue);
  const d = (a1 / 100000) * Math.min(w, h);
  const path = new Path2D();
  // Front face.
  path.moveTo(0, d);
  path.lineTo(w - d, d);
  path.lineTo(w - d, h);
  path.lineTo(0, h);
  path.closePath();
  // Top face.
  path.moveTo(0, d);
  path.lineTo(d, 0);
  path.lineTo(w, 0);
  path.lineTo(w - d, d);
  path.closePath();
  // Right face.
  path.moveTo(w - d, d);
  path.lineTo(w, 0);
  path.lineTo(w, h - d);
  path.lineTo(w - d, h);
  path.closePath();
  return path;
};

export const CUBE_HANDLES: readonly AdjustmentHandle[] = [
  // Diamond on the top edge at x = d. Drag right → larger depth.
  linearTopEdgeHandle({
    forward: (a, { w, h }) => (a / 100000) * Math.min(w, h),
    inverse: (x, { w, h }) => (x / Math.min(w, h)) * 100000,
    spec: CUBE_ADJUSTMENTS[0],
  }),
];
