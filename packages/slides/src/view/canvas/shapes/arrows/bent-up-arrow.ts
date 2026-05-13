import type {
  AdjustmentHandle,
  AdjustmentSpec,
  PathBuilder,
} from '../builder';
import { adj } from '../builder';
import { insetAlongAxis } from '../handles';

/**
 * `bentUpArrow` — L-shape (vertical right arm + horizontal bottom
 * arm) with the arrowhead pointing UP at the top of the vertical
 * arm. Mirror of `bentArrow` along the horizontal axis.
 */
export const BENT_UP_ARROW_ADJUSTMENTS: readonly AdjustmentSpec[] = [
  { name: 'Shaft thickness', defaultValue: 25000, min: 0, max: 50000 },
  { name: 'Head length', defaultValue: 25000, min: 0, max: 50000 },
];

export const buildBentUpArrow: PathBuilder = ({ w, h }, adjustments) => {
  const a1 = adj(adjustments, 0, 25000);
  const a2 = adj(adjustments, 1, 25000);
  const shaft = (a1 / 100000) * Math.min(w, h);
  const headLen = (a2 / 100000) * h;
  const headHalf = shaft * 0.75;
  const vx = w - headHalf;
  const vLeft = vx - shaft / 2;
  const vRight = vx + shaft / 2;
  const path = new Path2D();
  // CW from SW corner of horizontal bottom arm.
  path.moveTo(0, h);
  path.lineTo(0, h - shaft);
  path.lineTo(vLeft, h - shaft);
  path.lineTo(vLeft, headLen);
  path.lineTo(vx - headHalf, headLen);
  path.lineTo(vx, 0);
  path.lineTo(w, headLen);
  path.lineTo(vRight, headLen);
  path.lineTo(vRight, h);
  path.closePath();
  return path;
};

export const BENT_UP_ARROW_HANDLES: readonly AdjustmentHandle[] = [
  {
    position: ({ w, h }, adjustments) => {
      const shaft = ((adjustments[0] ?? 25000) / 100000) * Math.min(w, h);
      return { x: 0, y: insetAlongAxis(h - shaft, h) };
    },
    apply: ({ w, h }, start, pointer) => {
      const y = Math.max(0, Math.min(h, pointer.y));
      const shaft = Math.max(0, h - y);
      const span = Math.min(w, h);
      const raw = span > 0 ? Math.round((shaft / span) * 100000) : 0;
      const spec = BENT_UP_ARROW_ADJUSTMENTS[0];
      return [
        Math.max(spec.min, Math.min(spec.max, raw)),
        start[1] ?? 25000,
      ];
    },
  },
  {
    position: ({ w, h }, adjustments) => {
      const headLen = ((adjustments[1] ?? 25000) / 100000) * h;
      return { x: insetAlongAxis(w, w), y: insetAlongAxis(headLen, h) };
    },
    apply: ({ h }, start, pointer) => {
      const y = Math.max(0, Math.min(h, pointer.y));
      const raw = h > 0 ? Math.round((y / h) * 100000) : 0;
      const spec = BENT_UP_ARROW_ADJUSTMENTS[1];
      return [
        start[0] ?? 25000,
        Math.max(spec.min, Math.min(spec.max, raw)),
      ];
    },
  },
];
