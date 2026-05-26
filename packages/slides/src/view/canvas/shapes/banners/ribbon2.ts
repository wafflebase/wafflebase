import type {
  AdjustmentHandle,
  AdjustmentSpec,
  PathBuilder,
} from '../builder';
import { adj } from '../builder';
import { insetAlongAxis } from '../handles';

/**
 * `ribbon2` — horizontal banner with V-notched tails (concave),
 * the inverse of `ribbon`'s pointed tails. V0 V-shape between the
 * outer edge and the body start.
 */
export const RIBBON2_ADJUSTMENTS: readonly AdjustmentSpec[] = [
  { name: 'Body height', defaultValue: 50000, min: 0, max: 100000 },
  { name: 'Tail length', defaultValue: 16667, min: 0, max: 50000 },
];

export const buildRibbon2: PathBuilder = ({ w, h }, adjustments) => {
  const a1 = adj(adjustments, 0, 50000);
  const a2 = adj(adjustments, 1, 16667);
  const bodyHalf = (a1 / 100000) * (h / 2);
  const tail = (a2 / 100000) * w;
  const cy = h / 2;
  const path = new Path2D();
  // Outer-NW corner → V-notch in toward centre → up to body NW.
  path.moveTo(0, cy - bodyHalf);
  path.lineTo(tail, cy);
  path.lineTo(0, cy + bodyHalf);
  path.lineTo(tail, cy + bodyHalf);
  path.lineTo(w - tail, cy + bodyHalf);
  path.lineTo(w, cy + bodyHalf);
  path.lineTo(w - tail, cy);
  path.lineTo(w, cy - bodyHalf);
  path.lineTo(w - tail, cy - bodyHalf);
  path.lineTo(tail, cy - bodyHalf);
  path.closePath();
  return path;
};

export const RIBBON2_HANDLES: readonly AdjustmentHandle[] = [
  {
    position: ({ h }, adjustments) => {
      const bodyHalf = ((adjustments[0] ?? 50000) / 100000) * (h / 2);
      return { x: 0, y: insetAlongAxis(h / 2 - bodyHalf, h) };
    },
    apply: ({ h }, start, pointer) => {
      const y = Math.max(0, Math.min(h, pointer.y));
      const bodyHalf = Math.abs(y - h / 2);
      const raw = h > 0 ? Math.round((bodyHalf / (h / 2)) * 100000) : 0;
      const spec = RIBBON2_ADJUSTMENTS[0];
      return [
        Math.max(spec.min, Math.min(spec.max, raw)),
        start[1] ?? 16667,
      ];
    },
  },
  {
    position: ({ w, h }, adjustments) => {
      const tail = ((adjustments[1] ?? 16667) / 100000) * w;
      return { x: insetAlongAxis(tail, w), y: h / 2 };
    },
    apply: ({ w }, start, pointer) => {
      const x = Math.max(0, Math.min(w, pointer.x));
      const raw = w > 0 ? Math.round((x / w) * 100000) : 0;
      const spec = RIBBON2_ADJUSTMENTS[1];
      return [
        start[0] ?? 50000,
        Math.max(spec.min, Math.min(spec.max, raw)),
      ];
    },
  },
];
