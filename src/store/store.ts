import { Cell, Ref } from '../sheet/types';

/**
 * `Store` interface represents a storage that stores the cell values.
 */
export interface Store {
  set(key: Ref, value: Cell): Promise<void>;
  get(key: Ref): Promise<Cell | undefined>;
  has(key: Ref): Promise<boolean>;
  delete(key: Ref): Promise<boolean>;
  [Symbol.iterator](): IterableIterator<[Ref, Cell]>;
}
