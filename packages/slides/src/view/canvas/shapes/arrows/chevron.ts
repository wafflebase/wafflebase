import type { PathBuilder, AdjustmentSpec, AdjustmentHandle } from '../builder';
import { adj } from '../builder';

/**
 * `chevron` — right-pointing block chevron with a back notch.
 *
 * Adjustments (`CHEVRON_ADJUSTMENTS`):
 *   [0] adj — OOXML notch depth `x1 = ss*adj/100000` directly
 *       (thousandths of `ss = min(w,h)`); default 50000. The back
 *       notch sits at `x1`; the front point insets to `x2 = w - x1`.
 *       At the default `x1 = 50% of ss`.
 */
export const CHEVRON_ADJUSTMENTS: readonly AdjustmentSpec[] = [
  { name: 'Notch depth', defaultValue: 50000, min: 0, max: 100000 },
];

export const CHEVRON_HANDLES: readonly AdjustmentHandle[] = [
  {
    // OOXML ahXY pos x="x2" y="t" → handle at the front-point inset
    // x2 = w - x1, where x1 = ss*adj/100000.
    position: ({ w, h }, adjustments) => {
      // Clamp the stored adj to [0..100000] (matching CHEVRON_ADJUSTMENTS)
      // so a corrupt/out-of-range value can't push x1 past the frame and
      // desync the painted handle from the notch the builder draws.
      const a = Math.max(0, Math.min(100000, adjustments[0] ?? 50000));
      const x1 = (a / 100000) * Math.min(w, h);
      return { x: Math.min(w, w - x1), y: h / 2 };
    },
    apply: ({ w, h }, _start, pointer) => {
      // pointer.x maps to x2 = w - x1 ⇒ x1 = w - pointer.x ⇒
      // adj = x1 / ss * 100000.
      const ss = Math.min(w, h);
      const x1 = Math.max(0, Math.min(w, w - pointer.x));
      const value = ss > 0 ? Math.round((x1 / ss) * 100000) : 0;
      return [Math.max(0, Math.min(100000, value))];
    },
  },
];

export const buildChevron: PathBuilder = ({ w, h }, adjustments) => {
  // OOXML: x1 = ss * adj / 100000 (back notch depth), ss = min(w,h);
  // front point insets to x2 = w - x1.
  const ss = Math.min(w, h);
  // Clamp the stored adj to [0..100000] (matching CHEVRON_ADJUSTMENTS)
  // before deriving x1, so out-of-range data can't invert the notch.
  const a = Math.max(0, Math.min(100000, adj(adjustments, 0, 50000)));
  const x1 = Math.min(w, (a / 100000) * ss);
  const x2 = w - x1;
  const path = new Path2D();
  path.moveTo(0, 0);
  path.lineTo(x2, 0);
  path.lineTo(w, h / 2);
  path.lineTo(x2, h);
  path.lineTo(0, h);
  path.lineTo(x1, h / 2);
  path.closePath();
  return path;
};
