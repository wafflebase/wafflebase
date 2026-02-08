import { Ref } from '../model/types';
import { DimensionIndex } from '../model/dimensions';

// Cell dimensions
export const DefaultCellWidth = 100;
export const DefaultCellHeight = 23;

// Header dimensions
export const RowHeaderWidth = 50;

// Cell font and padding
export const CellFontSize = 13;
export const CellLineHeight = 1.5;
export const CellPaddingX = 4;
export const CellPaddingY = 5;

// Other constants
export const CellBorderWidth = 0.5;
export const HeaderTextAlign = 'center';
export const ScrollIntervalMS = 10;
export const ScrollSpeedMS = 10;

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
 * @param rowDim Optional row dimension index for variable heights
 * @param colDim Optional column dimension index for variable widths
 * @returns The bounding rectangle
 */
export function toBoundingRect(
  id: Ref,
  scroll = { left: 0, top: 0 },
  rowDim?: DimensionIndex,
  colDim?: DimensionIndex,
): BoundingRect {
  const colOffset = colDim
    ? colDim.getOffset(id.c)
    : (id.c - 1) * DefaultCellWidth;
  const rowOffset = rowDim
    ? rowDim.getOffset(id.r)
    : (id.r - 1) * DefaultCellHeight;
  const width = colDim ? colDim.getSize(id.c) : DefaultCellWidth;
  const height = rowDim ? rowDim.getSize(id.r) : DefaultCellHeight;

  return {
    left: colOffset + RowHeaderWidth - scroll.left,
    top: rowOffset + DefaultCellHeight - scroll.top,
    width,
    height,
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
  const left = Math.min(start.left, end.left);
  const top = Math.min(start.top, end.top);
  const right = Math.max(start.left + start.width, end.left + end.width);
  const bottom = Math.max(start.top + start.height, end.top + end.height);

  return {
    left,
    top,
    width: right - left,
    height: bottom - top,
  };
}

/**
 * `toRef` returns the Ref for the given x and y coordinates.
 * @param x The x coordinate (includes scroll offset)
 * @param y The y coordinate (includes scroll offset)
 * @param rowDim Optional row dimension index for variable heights
 * @param colDim Optional column dimension index for variable widths
 */
export function toRef(
  x: number,
  y: number,
  rowDim?: DimensionIndex,
  colDim?: DimensionIndex,
): Ref {
  const row = rowDim
    ? rowDim.findIndex(y - DefaultCellHeight)
    : Math.floor(y / DefaultCellHeight);
  const col = colDim
    ? colDim.findIndex(x - RowHeaderWidth)
    : Math.floor((x + RowHeaderWidth) / DefaultCellWidth);
  return { r: row, c: col };
}
