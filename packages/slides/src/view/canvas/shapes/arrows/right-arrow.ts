import type { PathBuilder, AdjustmentSpec } from '../builder';
import { adj } from '../builder';

/**
 * `rightArrow` — block arrow pointing right.
 *
 * Adjustments (shared with leftArrow/upArrow/downArrow/leftRightArrow
 * via `ARROW_ADJUSTMENTS`):
 *   [0] headLen  — OOXML thousandths of `w`; default 50000.
 *   [1] headWidth — OOXML thousandths of `h/2` (half-height); default 50000.
 */
export const ARROW_ADJUSTMENTS: readonly AdjustmentSpec[] = [
  { name: 'Head length', defaultValue: 50000, min: 0, max: 100000 },
  { name: 'Head width', defaultValue: 50000, min: 0, max: 100000 },
];

export const buildRightArrow: PathBuilder = ({ w, h }, adjustments) => {
  const headLen = Math.min(w, (adj(adjustments, 0, 50000) / 100000) * w);
  const headHalf = (adj(adjustments, 1, 50000) / 100000) * (h / 2);
  const path = new Path2D();
  path.moveTo(0, h / 2 - headHalf);
  path.lineTo(w - headLen, h / 2 - headHalf);
  path.lineTo(w - headLen, 0);
  path.lineTo(w, h / 2);
  path.lineTo(w - headLen, h);
  path.lineTo(w - headLen, h / 2 + headHalf);
  path.lineTo(0, h / 2 + headHalf);
  path.closePath();
  return path;
};
