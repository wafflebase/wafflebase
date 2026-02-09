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

// Freeze handle constants
export const FreezeHandleThickness = 4; // thickness of the rectangular bar handle
export const FreezeHandleHitArea = 10; // hover detection padding beyond the bar

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
 * FreezeState represents the freeze pane configuration.
 */
export type FreezeState = {
  frozenRows: number;
  frozenCols: number;
  frozenWidth: number;
  frozenHeight: number;
};

/**
 * NoFreeze is the default freeze state with no frozen rows or columns.
 */
export const NoFreeze: FreezeState = {
  frozenRows: 0,
  frozenCols: 0,
  frozenWidth: 0,
  frozenHeight: 0,
};

/**
 * `buildFreezeState` creates a FreezeState from freeze pane configuration.
 */
export function buildFreezeState(
  frozenRows: number,
  frozenCols: number,
  rowDim: DimensionIndex,
  colDim: DimensionIndex,
): FreezeState {
  if (frozenRows === 0 && frozenCols === 0) {
    return NoFreeze;
  }
  return {
    frozenRows,
    frozenCols,
    frozenWidth: frozenCols > 0 ? colDim.getOffset(frozenCols + 1) : 0,
    frozenHeight: frozenRows > 0 ? rowDim.getOffset(frozenRows + 1) : 0,
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

/**
 * `toRefWithFreeze` converts mouse coordinates to a cell Ref, accounting for freeze panes.
 * Points in frozen regions use scroll=0 for that axis; unfrozen regions use scroll offset.
 */
export function toRefWithFreeze(
  x: number,
  y: number,
  scroll: Position,
  rowDim: DimensionIndex,
  colDim: DimensionIndex,
  freeze: FreezeState,
): Ref {
  const inFrozenCols =
    freeze.frozenCols > 0 && x < RowHeaderWidth + freeze.frozenWidth;
  const inFrozenRows =
    freeze.frozenRows > 0 && y < DefaultCellHeight + freeze.frozenHeight;

  const absX = inFrozenCols
    ? x - RowHeaderWidth
    : x -
      RowHeaderWidth -
      freeze.frozenWidth +
      colDim.getOffset(freeze.frozenCols + 1) +
      scroll.left;
  const absY = inFrozenRows
    ? y - DefaultCellHeight
    : y -
      DefaultCellHeight -
      freeze.frozenHeight +
      rowDim.getOffset(freeze.frozenRows + 1) +
      scroll.top;

  const col = colDim.findIndex(absX);
  const row = rowDim.findIndex(absY);
  return { r: Math.max(1, row), c: Math.max(1, col) };
}

/**
 * `toBoundingRectWithFreeze` computes the bounding rectangle for a cell,
 * accounting for freeze panes. Returns the screen position of the cell.
 */
export function toBoundingRectWithFreeze(
  ref: Ref,
  scroll: Position,
  rowDim: DimensionIndex,
  colDim: DimensionIndex,
  freeze: FreezeState,
): BoundingRect {
  const colOffset = colDim.getOffset(ref.c);
  const rowOffset = rowDim.getOffset(ref.r);
  const width = colDim.getSize(ref.c);
  const height = rowDim.getSize(ref.r);

  const inFrozenCols = freeze.frozenCols > 0 && ref.c <= freeze.frozenCols;
  const inFrozenRows = freeze.frozenRows > 0 && ref.r <= freeze.frozenRows;

  const left = inFrozenCols
    ? colOffset + RowHeaderWidth
    : colOffset +
      RowHeaderWidth -
      scroll.left -
      colDim.getOffset(freeze.frozenCols + 1) +
      freeze.frozenWidth;
  const top = inFrozenRows
    ? rowOffset + DefaultCellHeight
    : rowOffset +
      DefaultCellHeight -
      scroll.top -
      rowDim.getOffset(freeze.frozenRows + 1) +
      freeze.frozenHeight;

  return { left, top, width, height };
}
