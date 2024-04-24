import { Cell, Ref } from '../sheet/types';

/**
 * `Store` interface represents a storage that stores the cell values.
 */
export interface Store {
  set(key: Ref, value: Cell): void;
  get(key: Ref): Cell | undefined;
  has(key: Ref): boolean;
  delete(key: Ref): boolean;
  [Symbol.iterator](): IterableIterator<[Ref, Cell]>;
}
