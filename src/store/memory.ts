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

  async set(ref: Ref, value: Cell) {
    this.grid.set(ref, value);
  }

  async get(ref: Ref): Promise<Cell | undefined> {
    return this.grid.get(ref);
  }

  async has(ref: Ref): Promise<boolean> {
    return this.grid.has(ref);
  }

  async delete(ref: Ref): Promise<boolean> {
    return this.grid.delete(ref);
  }

  range(from: Ref, to: Ref): AsyncIterable<[Ref, Cell]> {
    const entries = Array.from(this.grid.entries());
    let index = 0;

    return {
      [Symbol.asyncIterator](): AsyncIterator<[Ref, Cell]> {
        return {
          next: () => {
            while (index < entries.length) {
              const entry = entries[index++];
              if (entry[0] >= from && entry[0] <= to) {
                return Promise.resolve({ value: entry, done: false });
              }
            }
            return Promise.resolve({ value: undefined, done: true });
          },
        };
      },
    };
  }

  [Symbol.asyncIterator](): AsyncIterator<[Ref, Cell]> {
    const entries = Array.from(this.grid.entries());
    let index = 0;

    return {
      next: () => {
        if (index < entries.length) {
          return Promise.resolve({ value: entries[index++], done: false });
        } else {
          return Promise.resolve({ value: undefined, done: true });
        }
      },
    };
  }
}
