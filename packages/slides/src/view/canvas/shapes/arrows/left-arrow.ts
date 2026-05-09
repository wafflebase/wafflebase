import type { PathBuilder } from '../builder';
import { adj } from '../builder';

/**
 * `leftArrow` — block arrow pointing left. Mirror of `rightArrow`.
 * Reuses `ARROW_ADJUSTMENTS` from `right-arrow.ts`.
 */
export const buildLeftArrow: PathBuilder = ({ w, h }, adjustments) => {
  const headLen = Math.min(w, (adj(adjustments, 0, 50000) / 100000) * w);
  const headHalf = (adj(adjustments, 1, 50000) / 100000) * (h / 2);
  const path = new Path2D();
  path.moveTo(w, h / 2 - headHalf);
  path.lineTo(headLen, h / 2 - headHalf);
  path.lineTo(headLen, 0);
  path.lineTo(0, h / 2);
  path.lineTo(headLen, h);
  path.lineTo(headLen, h / 2 + headHalf);
  path.lineTo(w, h / 2 + headHalf);
  path.closePath();
  return path;
};
