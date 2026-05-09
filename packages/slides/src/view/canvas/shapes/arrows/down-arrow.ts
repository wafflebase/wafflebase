import type { PathBuilder } from '../builder';
import { adj } from '../builder';

/**
 * `downArrow` — block arrow pointing down.
 * Reuses `ARROW_ADJUSTMENTS` from `right-arrow.ts`.
 */
export const buildDownArrow: PathBuilder = ({ w, h }, adjustments) => {
  const headLen = Math.min(h, (adj(adjustments, 0, 50000) / 100000) * h);
  const headHalf = (adj(adjustments, 1, 50000) / 100000) * (w / 2);
  const path = new Path2D();
  path.moveTo(w / 2 - headHalf, 0);
  path.lineTo(w / 2 - headHalf, h - headLen);
  path.lineTo(0, h - headLen);
  path.lineTo(w / 2, h);
  path.lineTo(w, h - headLen);
  path.lineTo(w / 2 + headHalf, h - headLen);
  path.lineTo(w / 2 + headHalf, 0);
  path.closePath();
  return path;
};
