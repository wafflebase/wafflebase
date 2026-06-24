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
  // Head length scales by ss = min(w, h) (clamped to w), matching
  // `buildRightArrow` and the shared RIGHT_ARROW_HANDLES — so the handle
  // tracks the rendered head base on non-square frames.
  const ss = Math.min(w, h);
  const headLen = Math.min(w, (adj(adjustments, 0, 50000) / 100000) * ss);
  const headHalf = (adj(adjustments, 1, 50000) / 100000) * (h / 2);
  const path = new Path2D();
  // Per ECMA-376 the stripe boundaries are fixed fractions of
  // ss = min(w, h), independent of the arrowhead size:
  //   stripe 1: [0 .. ss/32]
  //   stripe 2: [ss/16 .. ss/8]
  //   body:     [5*ss/32 .. headStart] + arrowhead
  const ssd32 = ss / 32;
  const ssd16 = ss / 16;
  const ssd8 = ss / 8;
  const x4 = (5 * ss) / 32;
  const headStart = w - headLen;
  const top = h / 2 - headHalf;
  const bot = h / 2 + headHalf;
  // Stripe 1 (thin, near tail start): [0 .. ss/32].
  path.moveTo(0, top);
  path.lineTo(ssd32, top);
  path.lineTo(ssd32, bot);
  path.lineTo(0, bot);
  path.closePath();
  // Stripe 2 (thin): [ss/16 .. ss/8].
  path.moveTo(ssd16, top);
  path.lineTo(ssd8, top);
  path.lineTo(ssd8, bot);
  path.lineTo(ssd16, bot);
  path.closePath();
  // Body (wide) + arrowhead: from 5*ss/32 to the head start.
  path.moveTo(x4, top);
  path.lineTo(headStart, top);
  path.lineTo(headStart, 0);
  path.lineTo(w, h / 2);
  path.lineTo(headStart, h);
  path.lineTo(headStart, bot);
  path.lineTo(x4, bot);
  path.closePath();
  return path;
};
