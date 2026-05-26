import type { PathBuilder } from '../builder';
import { adj } from '../builder';
import { ARROW_ADJUSTMENTS, RIGHT_ARROW_HANDLES } from './right-arrow';

/**
 * `notchedRightArrow` — right arrow with a V-shaped notch cut into
 * the tail. Same `ARROW_ADJUSTMENTS` (head length + head width) as
 * `rightArrow`; the notch depth is geometric, fixed at half the
 * head length (matches the OOXML preset's default formula).
 */
export const NOTCHED_RIGHT_ARROW_ADJUSTMENTS = ARROW_ADJUSTMENTS;
export const NOTCHED_RIGHT_ARROW_HANDLES = RIGHT_ARROW_HANDLES;

export const buildNotchedRightArrow: PathBuilder = ({ w, h }, adjustments) => {
  const headLen = Math.min(w, (adj(adjustments, 0, 50000) / 100000) * w);
  const headHalf = (adj(adjustments, 1, 50000) / 100000) * (h / 2);
  const notchDepth = headLen / 2;
  const path = new Path2D();
  path.moveTo(0, h / 2 - headHalf);
  path.lineTo(w - headLen, h / 2 - headHalf);
  path.lineTo(w - headLen, 0);
  path.lineTo(w, h / 2);
  path.lineTo(w - headLen, h);
  path.lineTo(w - headLen, h / 2 + headHalf);
  path.lineTo(0, h / 2 + headHalf);
  // V notch back to start, dipping inward.
  path.lineTo(notchDepth, h / 2);
  path.closePath();
  return path;
};
