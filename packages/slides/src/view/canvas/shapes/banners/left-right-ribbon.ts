import type {
  AdjustmentHandle,
  AdjustmentSpec,
  PathBuilder,
} from '../builder';
import { adj } from '../builder';
import { insetAlongAxis } from '../handles';

/**
 * `leftRightRibbon` — horizontal banner with arrow-shaped tips
 * pointing both LEFT and RIGHT. Three adjustments: head width
 * (arrowhead vertical spread), shaft height (band), tail length
 * (how far the arrowhead extends).
 */
export const LEFT_RIGHT_RIBBON_ADJUSTMENTS: readonly AdjustmentSpec[] = [
  { name: 'Head width', defaultValue: 100000, min: 50000, max: 200000, axisLabel: 'headW' },
  { name: 'Body height', defaultValue: 50000, min: 0, max: 100000, axisLabel: 'body' },
  { name: 'Tail length', defaultValue: 25000, min: 0, max: 50000, axisLabel: 'tail' },
];

export const buildLeftRightRibbon: PathBuilder = ({ w, h }, adjustments) => {
  const a1 = adj(adjustments, 0, 100000);
  const a2 = adj(adjustments, 1, 50000);
  const a3 = adj(adjustments, 2, 25000);
  const headHalf = (a1 / 200000) * (h / 2);
  const bodyHalf = (a2 / 100000) * (h / 2) * 0.7;
  const tail = (a3 / 100000) * w;
  const cy = h / 2;
  const path = new Path2D();
  // CW from left tip.
  path.moveTo(0, cy);
  path.lineTo(tail, cy - headHalf);
  path.lineTo(tail, cy - bodyHalf);
  path.lineTo(w - tail, cy - bodyHalf);
  path.lineTo(w - tail, cy - headHalf);
  path.lineTo(w, cy);
  path.lineTo(w - tail, cy + headHalf);
  path.lineTo(w - tail, cy + bodyHalf);
  path.lineTo(tail, cy + bodyHalf);
  path.lineTo(tail, cy + headHalf);
  path.closePath();
  return path;
};

export const LEFT_RIGHT_RIBBON_HANDLES: readonly AdjustmentHandle[] = [
  // Head width — diamond on left edge at y = cy - headHalf.
  {
    position: ({ h }, adjustments) => {
      const headHalf = ((adjustments[0] ?? 100000) / 200000) * (h / 2);
      return { x: 0, y: insetAlongAxis(h / 2 - headHalf, h) };
    },
    apply: ({ h }, start, pointer) => {
      const y = Math.max(0, Math.min(h, pointer.y));
      const headHalf = Math.abs(y - h / 2);
      const raw = h > 0 ? Math.round((headHalf / (h / 2)) * 200000) : 0;
      const spec = LEFT_RIGHT_RIBBON_ADJUSTMENTS[0];
      return [
        Math.max(spec.min, Math.min(spec.max, raw)),
        start[1] ?? 50000,
        start[2] ?? 25000,
      ];
    },
  },
  // Body height — diamond on the body's top-left interior corner.
  {
    position: ({ w, h }, adjustments) => {
      const bodyHalf = ((adjustments[1] ?? 50000) / 100000) * (h / 2) * 0.7;
      const tail = ((adjustments[2] ?? 25000) / 100000) * w;
      return {
        x: insetAlongAxis(tail, w),
        y: insetAlongAxis(h / 2 - bodyHalf, h),
      };
    },
    apply: ({ h }, start, pointer) => {
      const y = Math.max(0, Math.min(h, pointer.y));
      const bodyHalf = Math.abs(y - h / 2);
      const raw = h > 0 ? Math.round((bodyHalf / (h / 2 * 0.7)) * 100000) : 0;
      const spec = LEFT_RIGHT_RIBBON_ADJUSTMENTS[1];
      return [
        start[0] ?? 100000,
        Math.max(spec.min, Math.min(spec.max, raw)),
        start[2] ?? 25000,
      ];
    },
  },
  // Tail length — diamond on top edge at x = tail.
  {
    position: ({ w, h }, adjustments) => {
      const tail = ((adjustments[2] ?? 25000) / 100000) * w;
      const headHalf = ((adjustments[0] ?? 100000) / 200000) * (h / 2);
      return {
        x: insetAlongAxis(tail, w),
        y: insetAlongAxis(h / 2 - headHalf, h),
      };
    },
    apply: ({ w }, start, pointer) => {
      const x = Math.max(0, Math.min(w, pointer.x));
      const raw = w > 0 ? Math.round((x / w) * 100000) : 0;
      const spec = LEFT_RIGHT_RIBBON_ADJUSTMENTS[2];
      return [
        start[0] ?? 100000,
        start[1] ?? 50000,
        Math.max(spec.min, Math.min(spec.max, raw)),
      ];
    },
  },
];
