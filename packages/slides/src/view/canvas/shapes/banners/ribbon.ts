import type {
  AdjustmentHandle,
  AdjustmentSpec,
  PathBuilder,
} from '../builder';
import { adj } from '../builder';
import { insetAlongAxis } from '../handles';

/**
 * `ribbon` — horizontal banner with pointed tails on both ends.
 * V0: stretched hexagon. `adj1` = body height (fraction of h/2),
 * `adj2` = tail length (fraction of w).
 */
export const RIBBON_ADJUSTMENTS: readonly AdjustmentSpec[] = [
  { name: 'Body height', defaultValue: 50000, min: 0, max: 100000 },
  { name: 'Tail length', defaultValue: 16667, min: 0, max: 50000 },
];

export const buildRibbon: PathBuilder = ({ w, h }, adjustments) => {
  const a1 = adj(adjustments, 0, 50000);
  const a2 = adj(adjustments, 1, 16667);
  const bodyHalf = (a1 / 100000) * (h / 2);
  const tail = (a2 / 100000) * w;
  const cy = h / 2;
  const path = new Path2D();
  path.moveTo(0, cy);
  path.lineTo(tail, cy - bodyHalf);
  path.lineTo(w - tail, cy - bodyHalf);
  path.lineTo(w, cy);
  path.lineTo(w - tail, cy + bodyHalf);
  path.lineTo(tail, cy + bodyHalf);
  path.closePath();
  return path;
};

export const RIBBON_HANDLES: readonly AdjustmentHandle[] = [
  {
    position: ({ h }, adjustments) => {
      const bodyHalf = ((adjustments[0] ?? 50000) / 100000) * (h / 2);
      return { x: 0, y: insetAlongAxis(h / 2 - bodyHalf, h) };
    },
    apply: ({ h }, start, pointer) => {
      const y = Math.max(0, Math.min(h, pointer.y));
      const bodyHalf = Math.abs(y - h / 2);
      const raw = h > 0 ? Math.round((bodyHalf / (h / 2)) * 100000) : 0;
      const spec = RIBBON_ADJUSTMENTS[0];
      return [
        Math.max(spec.min, Math.min(spec.max, raw)),
        start[1] ?? 16667,
      ];
    },
  },
  {
    position: ({ w, h }, adjustments) => {
      const tail = ((adjustments[1] ?? 16667) / 100000) * w;
      const bodyHalf = ((adjustments[0] ?? 50000) / 100000) * (h / 2);
      return {
        x: insetAlongAxis(tail, w),
        y: insetAlongAxis(h / 2 - bodyHalf, h),
      };
    },
    apply: ({ w }, start, pointer) => {
      const x = Math.max(0, Math.min(w, pointer.x));
      const raw = w > 0 ? Math.round((x / w) * 100000) : 0;
      const spec = RIBBON_ADJUSTMENTS[1];
      return [
        start[0] ?? 50000,
        Math.max(spec.min, Math.min(spec.max, raw)),
      ];
    },
  },
];
