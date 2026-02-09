import { Axis, Cell, Grid, Ref, Range, Sref, Direction } from '../model/types';

/**
 * `Store` interface represents a storage that stores the cell values.
 */
export interface Store {
  /**
   * `set` method sets the value of a cell.
   */
  set(ref: Ref, value: Cell): Promise<void>;

  /**
   * `get` method gets the value of a cell.
   */
  get(ref: Ref): Promise<Cell | undefined>;

  /**
   * `has` method checks if a cell exists.
   */
  has(ref: Ref): Promise<boolean>;

  /**
   * `delete` method deletes a cell.
   */
  delete(ref: Ref): Promise<boolean>;

  /**
   * `deleteRange` method deletes all cells within the given range.
   * Returns the set of Srefs that were actually deleted.
   */
  deleteRange(range: Range): Promise<Set<Sref>>;

  /**
   * `setGrid` method sets the grid.
   */
  setGrid(grid: Grid): Promise<void>;

  /**
   * `getGrid` method gets the grid.
   */
  getGrid(range: Range): Promise<Grid>;

  /**
   * `findEgde` method finds the edge of the grid.
   */
  findEdge(ref: Ref, direction: Direction, dimension: Range): Promise<Ref>;

  /**
   * `buildDependantsMap` method builds a map of dependants.
   */
  buildDependantsMap(srefs: Iterable<Sref>): Promise<Map<Sref, Set<Sref>>>;

  /**
   * `getPresences` method gets the user presences.
   */
  getPresences(): Array<{ clientID: string; presence: { activeCell: string } }>;

  /**
   * `shiftCells` method shifts cells along the given axis.
   * Positive count inserts, negative count deletes.
   */
  shiftCells(axis: Axis, index: number, count: number): Promise<void>;

  /**
   * `moveCells` method moves cells along the given axis.
   * Moves `count` rows/columns starting at `srcIndex` to before `dstIndex`.
   */
  moveCells(axis: Axis, srcIndex: number, count: number, dstIndex: number): Promise<void>;

  /**
   * `setDimensionSize` method sets a custom row height or column width.
   */
  setDimensionSize(axis: Axis, index: number, size: number): Promise<void>;

  /**
   * `getDimensionSizes` method gets all custom row heights or column widths.
   */
  getDimensionSizes(axis: Axis): Promise<Map<number, number>>;

  /**
   * `updateActiveCell` method updates the active cell of the current user.
   */
  updateActiveCell(activeCell: Ref): void;

  /**
   * `setFreezePane` method sets the freeze pane position.
   */
  setFreezePane(frozenRows: number, frozenCols: number): Promise<void>;

  /**
   * `getFreezePane` method gets the freeze pane position.
   */
  getFreezePane(): Promise<{ frozenRows: number; frozenCols: number }>;
}
