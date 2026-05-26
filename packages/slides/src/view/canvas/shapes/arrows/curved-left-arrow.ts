import {
  CURVED_ARROW_ADJUSTMENTS,
  curvedArrowHandles,
  makeCurvedArrowBuilder,
} from './curved';

/**
 * `curvedLeftArrow` — quarter band in the lower-left region with
 * a pointy tip extending west.
 */
export const CURVED_LEFT_ARROW_ADJUSTMENTS = CURVED_ARROW_ADJUSTMENTS;
export const buildCurvedLeftArrow = makeCurvedArrowBuilder('left');
export const CURVED_LEFT_ARROW_HANDLES = curvedArrowHandles('left');
