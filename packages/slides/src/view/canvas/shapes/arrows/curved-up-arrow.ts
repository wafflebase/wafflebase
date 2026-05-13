import {
  CURVED_ARROW_ADJUSTMENTS,
  curvedArrowHandles,
  makeCurvedArrowBuilder,
} from './curved';

/**
 * `curvedUpArrow` — quarter band in the upper region with a
 * pointy tip extending up (north).
 */
export const CURVED_UP_ARROW_ADJUSTMENTS = CURVED_ARROW_ADJUSTMENTS;
export const buildCurvedUpArrow = makeCurvedArrowBuilder('up');
export const CURVED_UP_ARROW_HANDLES = curvedArrowHandles('up');
