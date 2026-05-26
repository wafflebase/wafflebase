import type { PathBuilder, AdjustmentSpec, AdjustmentHandle } from '../builder';
import { adj } from '../builder';

/**
 * `chevron` — right-pointing block chevron with a back notch.
 *
 * Adjustments (`CHEVRON_ADJUSTMENTS`):
 *   [0] notchDepth — OOXML thousandths of `h/2`; default 50000.
 *       (The OOXML preset is geometrically slightly different, but this
 *        matches PowerPoint's visible default closely enough for v1.)
 */
export const CHEVRON_ADJUSTMENTS: readonly AdjustmentSpec[] = [
  { name: 'Notch depth', defaultValue: 50000, min: 0, max: 100000 },
];

export const CHEVRON_HANDLES: readonly AdjustmentHandle[] = [
  {
    position: ({ w, h }, adjustments) => {
      const ratio = (adjustments[0] ?? 50000) / 100000;
      const inset = ratio * (h / 2) * (w / h);
      return { x: inset, y: h / 2 };
    },
    apply: ({ w, h }, _start, pointer) => {
      // Inverse of inset = ratio * (h/2) * (w/h)
      const denom = (h / 2) * (w / h);
      const inset = Math.max(0, Math.min(w, pointer.x));
      const ratio = denom > 0 ? inset / denom : 0;
      const value = Math.round(ratio * 100000);
      return [Math.max(0, Math.min(100000, value))];
    },
  },
];

export const buildChevron: PathBuilder = ({ w, h }, adjustments) => {
  const notch = (adj(adjustments, 0, 50000) / 100000) * (h / 2);
  const tip = w; // pointing right
  const inset = Math.min(w, notch * (w / h)); // rough; OOXML uses min(w, h/2 * tan...)
  const path = new Path2D();
  path.moveTo(0, 0);
  path.lineTo(w - inset, 0);
  path.lineTo(tip, h / 2);
  path.lineTo(w - inset, h);
  path.lineTo(0, h);
  path.lineTo(inset, h / 2);
  path.closePath();
  return path;
};
