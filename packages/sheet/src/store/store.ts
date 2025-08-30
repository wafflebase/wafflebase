import { Cell, Grid, Ref, Range, Sref, Direction } from '../model/types';

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
   * `updateActiveCell` method updates the active cell of the current user.
   */
  updateActiveCell(activeCell: Ref): void;
}
