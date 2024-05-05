import { Cell, Grid, Ref, Range, Sref } from '../sheet/types';

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
   * `buildDependantsMap` method builds a map of dependants.
   */
  buildDependantsMap(srefs: Iterable<Sref>): Promise<Map<Sref, Set<Sref>>>;
}
