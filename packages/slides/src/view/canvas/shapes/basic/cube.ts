import type {
  AdjustmentHandle,
  AdjustmentSpec,
  FaceBuilder,
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

/**
 * Multi-fill faces for the cube's 3D look: the front face at the base
 * fill, the top face lightened, and the right face darkened — matching
 * how PowerPoint lights a cube (top toward the light, side in shadow).
 */
export const buildCubeFaces: FaceBuilder = ({ w, h }, adjustments) => {
  const a1 = adj(adjustments, 0, CUBE_ADJUSTMENTS[0].defaultValue);
  const d = (a1 / 100000) * Math.min(w, h);
  const front = new Path2D();
  front.moveTo(0, d);
  front.lineTo(w - d, d);
  front.lineTo(w - d, h);
  front.lineTo(0, h);
  front.closePath();
  const top = new Path2D();
  top.moveTo(0, d);
  top.lineTo(d, 0);
  top.lineTo(w, 0);
  top.lineTo(w - d, d);
  top.closePath();
  const right = new Path2D();
  right.moveTo(w - d, d);
  right.lineTo(w, 0);
  right.lineTo(w, h - d);
  right.lineTo(w - d, h);
  right.closePath();
  return [
    { path: front, shade: 0 },
    { path: top, shade: 0.18 },
    { path: right, shade: -0.18 },
  ];
};

export const CUBE_HANDLES: readonly AdjustmentHandle[] = [
  // Diamond on the top edge at x = d. Drag right → larger depth.
  linearTopEdgeHandle({
    forward: (a, { w, h }) => (a / 100000) * Math.min(w, h),
    inverse: (x, { w, h }) => (x / Math.min(w, h)) * 100000,
    spec: CUBE_ADJUSTMENTS[0],
  }),
];
