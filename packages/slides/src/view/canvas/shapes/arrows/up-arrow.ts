import type { PathBuilder } from '../builder';
import { adj } from '../builder';

/**
 * `upArrow` — block arrow pointing up.
 * Reuses `ARROW_ADJUSTMENTS` from `right-arrow.ts`.
 */
export const buildUpArrow: PathBuilder = ({ w, h }, adjustments) => {
  const headLen = Math.min(h, (adj(adjustments, 0, 50000) / 100000) * h);
  const headHalf = (adj(adjustments, 1, 50000) / 100000) * (w / 2);
  const path = new Path2D();
  path.moveTo(w / 2 - headHalf, h);
  path.lineTo(w / 2 - headHalf, headLen);
  path.lineTo(0, headLen);
  path.lineTo(w / 2, 0);
  path.lineTo(w, headLen);
  path.lineTo(w / 2 + headHalf, headLen);
  path.lineTo(w / 2 + headHalf, h);
  path.closePath();
  return path;
};
