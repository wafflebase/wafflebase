import type { PathBuilder, AdjustmentSpec, AdjustmentHandle } from '../builder';
import { adj } from '../builder';

/**
 * `roundRect` — rectangle with quadratic-Bezier rounded corners.
 *
 * Adjustments:
 *   [0] cornerRadiusRatio — OOXML thousandths of `min(w,h)`; default
 *       16667 (~16.7%). Clamped to [0, 50000].
 */
export const ROUND_RECT_ADJUSTMENTS: readonly AdjustmentSpec[] = [
  {
    name: 'Corner radius',
    defaultValue: 16667,
    min: 0,
    max: 50000,
    format: (v) => `${(v / 1000).toFixed(1)}%`,
  },
];

const RR_MIN = 0;
const RR_MAX = 50000;

export const ROUND_RECT_HANDLES: readonly AdjustmentHandle[] = [
  {
    position: ({ w, h }, adjustments) => {
      const ratio = (adjustments[0] ?? 16667) / 100000;
      const r = Math.max(0, Math.min(w, h) * ratio);
      return { x: r, y: 0 };
    },
    apply: ({ w, h }, _start, pointer) => {
      const halfMin = Math.min(w, h) / 2;
      const r = Math.max(0, Math.min(halfMin, pointer.x));
      // r = ratio * min(w,h) → ratio = r / min(w,h)
      const ratio = r / Math.min(w, h);
      const value = Math.round(ratio * 100000);
      return [Math.max(RR_MIN, Math.min(RR_MAX, value))];
    },
  },
];

export const buildRoundRect: PathBuilder = ({ w, h }, adjustments) => {
  const ratio = adj(adjustments, 0, 16667) / 100000;
  const r = Math.max(0, Math.min(w, h) * ratio);
  const path = new Path2D();
  path.moveTo(r, 0);
  path.lineTo(w - r, 0);
  path.quadraticCurveTo(w, 0, w, r);
  path.lineTo(w, h - r);
  path.quadraticCurveTo(w, h, w - r, h);
  path.lineTo(r, h);
  path.quadraticCurveTo(0, h, 0, h - r);
  path.lineTo(0, r);
  path.quadraticCurveTo(0, 0, r, 0);
  path.closePath();
  return path;
};
