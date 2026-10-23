import { Range, Ref } from '../model/core/types';

/**
 * How far, in CSS pixels, the pointer must travel after pressing the
 * selection border before the press becomes a drag-move. Below it the
 * gesture is a click.
 */
export const CellDragMoveThreshold = 4;

/**
 * `cellDragMoveDestination` returns the top-left of where a drag-moved range
 * lands: the source shifted by the cells the pointer has crossed since it
 * grabbed the border.
 *
 * The destination is relative to the grab point, not the cell under the
 * pointer. The border hit band straddles the edge, so the press itself often
 * lands in the neighbouring cell; taking that cell as the destination moved
 * the range before the pointer did, and a click on the border committed it.
 */
export function cellDragMoveDestination(
  source: Range,
  anchor: Ref,
  pointer: Ref,
): Ref {
  const minR = Math.min(source[0].r, source[1].r);
  const minC = Math.min(source[0].c, source[1].c);
  return {
    r: Math.max(1, minR + pointer.r - anchor.r),
    c: Math.max(1, minC + pointer.c - anchor.c),
  };
}

/**
 * `exceedsCellDragMoveThreshold` reports whether the pointer has travelled
 * far enough from the press to start a drag-move.
 */
export function exceedsCellDragMoveThreshold(
  startX: number,
  startY: number,
  x: number,
  y: number,
): boolean {
  return Math.hypot(x - startX, y - startY) >= CellDragMoveThreshold;
}
