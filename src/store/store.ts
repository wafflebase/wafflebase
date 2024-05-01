import { Cell, Grid, Ref, Range, Sref } from '../sheet/types';

/**
 * `Store` interface represents a storage that stores the cell values.
 */
export interface Store {
  set(ref: Ref, value: Cell): Promise<void>;
  get(ref: Ref): Promise<Cell | undefined>;
  has(ref: Ref): Promise<boolean>;
  delete(ref: Ref): Promise<boolean>;
  setGrid(grid: Grid): Promise<void>;
  getGrid(range: Range): Promise<Grid>;
  buildDependantsMap(srefs: Iterable<Sref>): Promise<Map<Sref, Set<Sref>>>;
}
