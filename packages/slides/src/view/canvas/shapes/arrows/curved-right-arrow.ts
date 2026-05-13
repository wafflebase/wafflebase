import {
  CURVED_ARROW_ADJUSTMENTS,
  curvedArrowHandles,
  makeCurvedArrowBuilder,
} from './curved';

/**
 * `curvedRightArrow` — quarter band in the lower-right region of
 * the frame with a pointy tip extending east. Built via the
 * shared `curved.ts` factory.
 */
export const CURVED_RIGHT_ARROW_ADJUSTMENTS = CURVED_ARROW_ADJUSTMENTS;
export const buildCurvedRightArrow = makeCurvedArrowBuilder('right');
export const CURVED_RIGHT_ARROW_HANDLES = curvedArrowHandles('right');
