import { Ref, Cell, Grid } from '../sheet/types';

/**
 * `MemStore` class represents an in-memory storage.
 * It is used in testing and development.
 */
export class MemStore {
  private grid: Map<Ref, Cell>;

  constructor(grid?: Grid) {
    this.grid = grid || new Map();
  }

  set(key: Ref, value: Cell) {
    this.grid.set(key, value);
  }

  get(key: Ref): Cell | undefined {
    return this.grid.get(key);
  }

  has(key: Ref): boolean {
    return this.grid.has(key);
  }

  delete(key: Ref): boolean {
    return this.grid.delete(key);
  }

  [Symbol.iterator](): IterableIterator<[Ref, Cell]> {
    return this.grid.entries();
  }
}
