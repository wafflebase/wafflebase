import type { PathBuilder, AdjustmentSpec } from '../builder';
import { adj } from '../builder';

/**
 * `octagon` — rectangle with 45° corner cuts.
 *
 * Adjustments:
 *   [0] cornerCut — OOXML thousandths of `min(w,h)`; default 29289
 *       (matches PowerPoint's preset).
 */
export const OCTAGON_ADJUSTMENTS: readonly AdjustmentSpec[] = [
  { name: 'Corner cut', defaultValue: 29289, min: 0, max: 50000 },
];

export const buildOctagon: PathBuilder = ({ w, h }, adjustments) => {
  const cut = (adj(adjustments, 0, 29289) / 100000) * Math.min(w, h);
  const path = new Path2D();
  path.moveTo(cut, 0);
  path.lineTo(w - cut, 0);
  path.lineTo(w, cut);
  path.lineTo(w, h - cut);
  path.lineTo(w - cut, h);
  path.lineTo(cut, h);
  path.lineTo(0, h - cut);
  path.lineTo(0, cut);
  path.closePath();
  return path;
};
