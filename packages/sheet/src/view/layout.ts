import { Ref } from '../model/types';

// Cell dimensions
export const DefaultCellWidth = 100;
export const DefaultCellHeight = 23;

// Header dimensions
export const RowHeaderWidth = 50;

// Other constants
export const CellBorderWidth = 0.5;
export const HeaderTextAlign = 'center';
export const ScrollIntervalMS = 10;
export const ScrollSpeedMS = 10;

/**
 * TODO(hackerwins): We need to use `bigint` for the coordinates
 * and `number` for the width and height. Because the coordinates
 * can be very large for big dimensions of the grid.
 */

/**
 * Position represents the position of a rectangle.
 */
export type Position = { left: number; top: number };

/**
 * Size represents the size of a rectangle.
 */
export type Size = { width: number; height: number };

/**
 * BoundingRect represents the bounding rectangle of a cell or UI element.
 * It combines position and size properties.
 */
export type BoundingRect = Position & Size;

/**
 * Calculates the bounding rectangle for a cell reference with scroll position
 * @param id The cell reference
 * @param scroll The scroll position
 * @returns The bounding rectangle
 */
export function toBoundingRect(
  id: Ref,
  scroll = { left: 0, top: 0 },
): BoundingRect {
  return {
    left: (id.c - 1) * DefaultCellWidth + RowHeaderWidth - scroll.left,
    top: (id.r - 1) * DefaultCellHeight + DefaultCellHeight - scroll.top,
    width: DefaultCellWidth,
    height: DefaultCellHeight,
  };
}

/**
 * Expands a bounding rectangle to include another bounding rectangle
 * @param start The starting bounding rectangle
 * @param end The ending bounding rectangle
 * @returns The expanded bounding rectangle
 */
export function expandBoundingRect(
  start: BoundingRect,
  end: BoundingRect,
): BoundingRect {
  return {
    left: Math.min(start.left, end.left),
    top: Math.min(start.top, end.top),
    width: Math.abs(start.left - end.left) + DefaultCellWidth,
    height: Math.abs(start.top - end.top) + DefaultCellHeight,
  };
}

/**
 * `toRef` returns the Ref for the given x and y coordinates.
 */
export function toRef(x: number, y: number): Ref {
  const row = Math.floor(y / DefaultCellHeight);
  const col = Math.floor((x + RowHeaderWidth) / DefaultCellWidth);
  return { r: row, c: col };
}
