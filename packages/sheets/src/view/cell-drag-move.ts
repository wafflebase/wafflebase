import { BoundingRect } from './layout';

/**
 * How far, in CSS pixels, the pointer must travel after pressing the
 * selection border or the fill handle before the press becomes a drag.
 * Below it the gesture is a click.
 */
export const CellDragThreshold = 4;

export type Point = { x: number; y: number };

/**
 * `cellDragGrabOffset` returns where the pointer pressed, relative to the
 * centre of the source range's top-left cell. During a drag-move,
 * `pointer - offset` is where that centre has been carried to, so the cell
 * under that point is the destination's top-left — the grab offset Excel and
 * Google Sheets preserve.
 *
 * The offset is in pixels, not cells. The border hit band straddles the edge,
 * so the press often lands in a neighbouring cell, and in index space that
 * cell can be far away: past rows a filter hid, or across the freeze gap,
 * which maps to the first unscrolled row. Pixels carry none of that, and
 * aiming at the cell's centre keeps the carried point off the gridlines.
 */
export function cellDragGrabOffset(
  press: Point,
  topLeftCell: BoundingRect,
): Point {
  return {
    x: press.x - (topLeftCell.left + topLeftCell.width / 2),
    y: press.y - (topLeftCell.top + topLeftCell.height / 2),
  };
}

/**
 * `exceedsCellDragThreshold` reports whether the pointer has travelled
 * far enough from the press to start a drag-move or a drag-fill.
 */
export function exceedsCellDragThreshold(
  startX: number,
  startY: number,
  x: number,
  y: number,
): boolean {
  return Math.hypot(x - startX, y - startY) >= CellDragThreshold;
}
