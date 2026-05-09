import type { PathBuilder, AdjustmentSpec } from '../builder';
import { adj } from '../builder';

/**
 * `mathPlus` — `+` glyph filling the frame as two crossed bars.
 *
 * Adjustments (`MATH_PLUS_ADJUSTMENTS`):
 *   [0] armThickness — OOXML thousandths of `min(w,h)`. Default 23520.
 *
 * Composed of two `path.rect()` sub-paths (horizontal + vertical bar).
 * The overlap at the centre is filled twice under non-zero fill rule —
 * still solid, no hole — which matches OOXML behaviour.
 */
export const MATH_PLUS_ADJUSTMENTS: readonly AdjustmentSpec[] = [
  { name: 'Arm thickness', defaultValue: 23520, min: 0, max: 50000 },
];

export const buildMathPlus: PathBuilder = ({ w, h }, adjustments) => {
  const t = (adj(adjustments, 0, 23520) / 100000) * Math.min(w, h);
  const cx = w / 2;
  const cy = h / 2;
  const path = new Path2D();
  // Horizontal bar.
  path.rect(0, cy - t / 2, w, t);
  // Vertical bar.
  path.rect(cx - t / 2, 0, t, h);
  return path;
};
