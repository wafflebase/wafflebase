import type { PathBuilder } from '../builder';
import { adj } from '../builder';

/**
 * `leftRightArrow` — double-headed horizontal arrow.
 * Reuses `ARROW_ADJUSTMENTS` from `right-arrow.ts`.
 */
export const buildLeftRightArrow: PathBuilder = ({ w, h }, adjustments) => {
  const head = Math.min(w / 2, (adj(adjustments, 0, 50000) / 100000) * (w / 2));
  const headHalf = (adj(adjustments, 1, 50000) / 100000) * (h / 2);
  const path = new Path2D();
  path.moveTo(0, h / 2);
  path.lineTo(head, 0);
  path.lineTo(head, h / 2 - headHalf);
  path.lineTo(w - head, h / 2 - headHalf);
  path.lineTo(w - head, 0);
  path.lineTo(w, h / 2);
  path.lineTo(w - head, h);
  path.lineTo(w - head, h / 2 + headHalf);
  path.lineTo(head, h / 2 + headHalf);
  path.lineTo(head, h);
  path.closePath();
  return path;
};
