import type {
  AdjustmentHandle,
  AdjustmentSpec,
  PathBuilder,
} from '../builder';
import { adj } from '../builder';
import { insetAlongAxis } from '../handles';

/**
 * `bentArrow` — Γ-shape (horizontal top arm + vertical right arm)
 * with the arrowhead pointing down at the bottom of the vertical
 * arm. V0: 90° sharp corner, two adjustments (shaft thickness +
 * head length). Arrowhead is 50% wider than the shaft per side.
 */
export const BENT_ARROW_ADJUSTMENTS: readonly AdjustmentSpec[] = [
  { name: 'Shaft thickness', defaultValue: 25000, min: 0, max: 50000 },
  { name: 'Head length', defaultValue: 25000, min: 0, max: 50000 },
];

export const buildBentArrow: PathBuilder = ({ w, h }, adjustments) => {
  const a1 = adj(adjustments, 0, 25000);
  const a2 = adj(adjustments, 1, 25000);
  const shaft = (a1 / 100000) * Math.min(w, h);
  const headLen = (a2 / 100000) * h;
  const headHalf = shaft * 0.75;
  // Vertical-arm centre x; arrowhead's right edge aligns to frame.
  const vx = w - headHalf;
  const vLeft = vx - shaft / 2;
  const vRight = vx + shaft / 2;
  const path = new Path2D();
  path.moveTo(0, 0);
  path.lineTo(vRight, 0);
  path.lineTo(vRight, h - headLen);
  path.lineTo(w, h - headLen);
  path.lineTo(vx, h);
  path.lineTo(vx - headHalf, h - headLen);
  path.lineTo(vLeft, h - headLen);
  path.lineTo(vLeft, shaft);
  path.lineTo(0, shaft);
  path.closePath();
  return path;
};

export const BENT_ARROW_HANDLES: readonly AdjustmentHandle[] = [
  // Shaft thickness — diamond on the left edge at y = shaft.
  {
    position: ({ w, h }, adjustments) => {
      const shaft = ((adjustments[0] ?? 25000) / 100000) * Math.min(w, h);
      return { x: 0, y: insetAlongAxis(shaft, h) };
    },
    apply: ({ w, h }, start, pointer) => {
      const y = Math.max(0, Math.min(h, pointer.y));
      const span = Math.min(w, h);
      const raw = span > 0 ? Math.round((y / span) * 100000) : 0;
      const spec = BENT_ARROW_ADJUSTMENTS[0];
      return [
        Math.max(spec.min, Math.min(spec.max, raw)),
        start[1] ?? 25000,
      ];
    },
  },
  // Head length — diamond on the right edge at y = h - headLen.
  {
    position: ({ w, h }, adjustments) => {
      const headLen = ((adjustments[1] ?? 25000) / 100000) * h;
      return { x: insetAlongAxis(w, w), y: insetAlongAxis(h - headLen, h) };
    },
    apply: ({ h }, start, pointer) => {
      const y = Math.max(0, Math.min(h, pointer.y));
      const headLen = Math.max(0, h - y);
      const raw = h > 0 ? Math.round((headLen / h) * 100000) : 0;
      const spec = BENT_ARROW_ADJUSTMENTS[1];
      return [
        start[0] ?? 25000,
        Math.max(spec.min, Math.min(spec.max, raw)),
      ];
    },
  },
];
