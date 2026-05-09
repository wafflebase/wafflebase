import type { PathBuilder } from '../builder';
import { adj } from '../builder';

/**
 * `mathMinus` — `−` glyph: a single horizontal bar centered vertically.
 *
 * Adjustments — re-uses `MATH_PLUS_ADJUSTMENTS`:
 *   [0] armThickness — OOXML thousandths of `min(w,h)`. Default 23520.
 */
export const buildMathMinus: PathBuilder = ({ w, h }, adjustments) => {
  const t = (adj(adjustments, 0, 23520) / 100000) * Math.min(w, h);
  const path = new Path2D();
  path.rect(0, h / 2 - t / 2, w, t);
  return path;
};
