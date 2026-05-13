import type { PathBuilder } from '../builder';
import { adj } from '../builder';
import { ARROW_ADJUSTMENTS, RIGHT_ARROW_HANDLES } from './right-arrow';

/**
 * `stripedRightArrow` — right arrow with three vertical stripes on
 * the tail. The stripes are separate subpaths so non-zero winding
 * renders them as a single connected silhouette while picker
 * stroke shows the gaps as outlines. Same `ARROW_ADJUSTMENTS` as
 * `rightArrow`; stripe count and proportions are fixed.
 */
export const STRIPED_RIGHT_ARROW_ADJUSTMENTS = ARROW_ADJUSTMENTS;
export const STRIPED_RIGHT_ARROW_HANDLES = RIGHT_ARROW_HANDLES;

export const buildStripedRightArrow: PathBuilder = ({ w, h }, adjustments) => {
  const headLen = Math.min(w, (adj(adjustments, 0, 50000) / 100000) * w);
  const headHalf = (adj(adjustments, 1, 50000) / 100000) * (h / 2);
  const path = new Path2D();
  // Three stripes — small / small / wide — occupying the tail half
  // up to the head start.
  const tailEnd = w - headLen;
  const stripeUnit = tailEnd / 5;
  // Stripe 1 (thin, near tail start).
  path.moveTo(0, h / 2 - headHalf);
  path.lineTo(stripeUnit * 0.5, h / 2 - headHalf);
  path.lineTo(stripeUnit * 0.5, h / 2 + headHalf);
  path.lineTo(0, h / 2 + headHalf);
  path.closePath();
  // Stripe 2 (thin).
  path.moveTo(stripeUnit * 1.0, h / 2 - headHalf);
  path.lineTo(stripeUnit * 1.5, h / 2 - headHalf);
  path.lineTo(stripeUnit * 1.5, h / 2 + headHalf);
  path.lineTo(stripeUnit * 1.0, h / 2 + headHalf);
  path.closePath();
  // Stripe 3 (wide) + arrowhead.
  path.moveTo(stripeUnit * 2.0, h / 2 - headHalf);
  path.lineTo(w - headLen, h / 2 - headHalf);
  path.lineTo(w - headLen, 0);
  path.lineTo(w, h / 2);
  path.lineTo(w - headLen, h);
  path.lineTo(w - headLen, h / 2 + headHalf);
  path.lineTo(stripeUnit * 2.0, h / 2 + headHalf);
  path.closePath();
  return path;
};
