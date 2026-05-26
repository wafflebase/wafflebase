import type {
  AdjustmentHandle,
  AdjustmentSpec,
  PathBuilder,
} from '../builder';
import { adj } from '../builder';
import {
  linearLeftEdgeHandle,
  linearTopEdgeHandle,
} from '../handles';

/**
 * `halfFrame` — L-shape covering the NW corner of the frame. The top
 * arm has thickness `adj1` (vertical), the left arm has thickness
 * `adj2` (horizontal), both expressed in OOXML thousandths of the
 * matching frame dimension.
 */
export const HALF_FRAME_ADJUSTMENTS: readonly AdjustmentSpec[] = [
  {
    name: 'Top arm thickness',
    defaultValue: 33333,
    min: 0,
    max: 100000,
    axisLabel: 'top',
  },
  {
    name: 'Left arm thickness',
    defaultValue: 33333,
    min: 0,
    max: 100000,
    axisLabel: 'left',
  },
];

export const buildHalfFrame: PathBuilder = ({ w, h }, adjustments) => {
  const a1 = adj(adjustments, 0, HALF_FRAME_ADJUSTMENTS[0].defaultValue);
  const a2 = adj(adjustments, 1, HALF_FRAME_ADJUSTMENTS[1].defaultValue);
  const t1 = (a1 / 100000) * h;
  const t2 = (a2 / 100000) * w;
  const path = new Path2D();
  path.moveTo(0, 0);
  path.lineTo(w, 0);
  path.lineTo(w, t1);
  path.lineTo(t2, t1);
  path.lineTo(t2, h);
  path.lineTo(0, h);
  path.closePath();
  return path;
};

export const HALF_FRAME_HANDLES: readonly AdjustmentHandle[] = [
  // Top-arm thickness diamond paints on the left edge at the inner
  // corner's y coordinate. Dragging down increases t1.
  linearLeftEdgeHandle({
    forward: (a, { h }) => (a / 100000) * h,
    inverse: (y, { h }) => (y / h) * 100000,
    spec: HALF_FRAME_ADJUSTMENTS[0],
    index: 0,
  }),
  // Left-arm thickness diamond paints on the top edge at the inner
  // corner's x coordinate.
  linearTopEdgeHandle({
    forward: (a, { w }) => (a / 100000) * w,
    inverse: (x, { w }) => (x / w) * 100000,
    spec: HALF_FRAME_ADJUSTMENTS[1],
    index: 1,
  }),
];
