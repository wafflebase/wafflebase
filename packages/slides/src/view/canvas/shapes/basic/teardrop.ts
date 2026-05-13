import type {
  AdjustmentHandle,
  AdjustmentSpec,
  PathBuilder,
} from '../builder';
import { adj } from '../builder';
import { polylineArc } from '../curves';
import { insetAlongAxis } from '../handles';

/**
 * `teardrop` — V0: bottom half of an ellipse plus an upward point
 * controlled by `adj1`. At `adj1 = 0` the shape collapses to a full
 * ellipse; at `adj1 = 100000` the point reaches the top edge.
 */
export const TEARDROP_ADJUSTMENTS: readonly AdjustmentSpec[] = [
  {
    name: 'Tip extension',
    defaultValue: 100000,
    min: 0,
    max: 200000,
  },
];

export const buildTeardrop: PathBuilder = ({ w, h }, adjustments) => {
  const a = adj(adjustments, 0, TEARDROP_ADJUSTMENTS[0].defaultValue);
  const cx = w / 2;
  const cy = h / 2;
  const rx = w / 2;
  const ry = h / 2;
  const tipY = cy - ry * (a / 100000);
  const path = new Path2D();
  path.moveTo(cx, tipY);
  path.lineTo(cx + rx, cy);
  const bottom = polylineArc(cx, cy, rx, ry, 0, Math.PI, 16);
  for (let i = 1; i < bottom.length; i++) {
    path.lineTo(bottom[i].x, bottom[i].y);
  }
  path.lineTo(cx, tipY);
  path.closePath();
  return path;
};

export const TEARDROP_HANDLES: readonly AdjustmentHandle[] = [
  {
    position: ({ w, h }, adjustments) => {
      const a = adjustments[0] ?? TEARDROP_ADJUSTMENTS[0].defaultValue;
      const tipY = (h / 2) - (h / 2) * (a / 100000);
      return { x: w / 2, y: insetAlongAxis(tipY, h) };
    },
    apply: ({ h }, start, pointer) => {
      if (h <= 0) return [...start];
      // tipY = h/2 (1 - a/100000)  ⇒  a = 100000 (1 - 2y/h)
      const raw = Math.round(100000 * (1 - (2 * pointer.y) / h));
      const spec = TEARDROP_ADJUSTMENTS[0];
      const clamped = Math.max(spec.min, Math.min(spec.max, raw));
      const result = [...start];
      result[0] = clamped;
      return result;
    },
  },
];
