import {
  CURVED_ARROW_ADJUSTMENTS,
  curvedArrowHandles,
  makeCurvedArrowBuilder,
} from './curved';

/**
 * `curvedDownArrow` — quarter band in the upper-left region with
 * a pointy tip extending down (south).
 */
export const CURVED_DOWN_ARROW_ADJUSTMENTS = CURVED_ARROW_ADJUSTMENTS;
export const buildCurvedDownArrow = makeCurvedArrowBuilder('down');
export const CURVED_DOWN_ARROW_HANDLES = curvedArrowHandles('down');
