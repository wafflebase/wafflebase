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

  async set(key: Ref, value: Cell) {
    this.grid.set(key, value);
  }

  async get(key: Ref): Promise<Cell | undefined> {
    return this.grid.get(key);
  }

  async has(key: Ref): Promise<boolean> {
    return this.grid.has(key);
  }

  async delete(key: Ref): Promise<boolean> {
    return this.grid.delete(key);
  }

  [Symbol.iterator](): IterableIterator<[Ref, Cell]> {
    return this.grid.entries();
  }
}
