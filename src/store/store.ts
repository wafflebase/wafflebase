import { Cell, Grid, Ref } from '../sheet/types';

/**
 * `Store` interface represents a storage that stores the cell values.
 */
export interface Store {
  set(ref: Ref, value: Cell): Promise<void>;
  get(ref: Ref): Promise<Cell | undefined>;
  has(ref: Ref): Promise<boolean>;
  delete(ref: Ref): Promise<boolean>;
  range(from: Ref, to: Ref): AsyncIterable<[Ref, Cell]>;
  setGrid(grid: Grid): Promise<void>;
  [Symbol.asyncIterator](): AsyncIterator<[Ref, Cell]>;
}
