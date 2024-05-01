import { Cell, Grid, Ref } from '../sheet/types';
import { Store } from './store';
import { createWorkerIDBStore } from './idb/workeridb';
import { Cache } from './memory/cache';
import { toRefRangeFromRefs } from '../sheet/coordinates';

export async function createStore(key: string): Promise<LocalStore> {
  const idb = await createWorkerIDBStore(key);
  return new LocalStore(idb);
}

/**
 * `LocalStore` class represents a cached IndexedDB storage.
 */
export class LocalStore {
  private cache: Cache;
  private store: Store;

  constructor(idb: Store) {
    this.cache = new Cache();
    this.store = idb;
  }

  async set(ref: Ref, cell: Cell): Promise<void> {
    this.cache.set(ref, cell);
    await this.store.set(ref, cell);
  }

  async get(ref: Ref): Promise<Cell | undefined> {
    if (this.cache.hasRange(toRefRangeFromRefs([ref]))) {
      return this.cache.get(ref);
    }

    const cell = await this.store.get(ref);
    if (cell !== undefined) {
      this.cache.set(ref, cell);
    } else {
      this.cache.delete(ref);
    }

    return cell;
  }

  async has(ref: Ref): Promise<boolean> {
    if (this.cache.hasRange(toRefRangeFromRefs([ref]))) {
      return this.cache.has(ref);
    }

    return await this.store.has(ref);
  }

  async delete(ref: Ref): Promise<boolean> {
    this.cache.delete(ref);
    return await this.store.delete(ref);
  }

  async setGrid(grid: Grid): Promise<void> {
    await this.store.setGrid(grid);
  }

  async *range(from: Ref, to: Ref): AsyncIterable<[Ref, Cell]> {
    if (this.cache.hasRange(toRefRangeFromRefs([from, to]))) {
      for (const [ref, cell] of this.cache.range(from, to)) {
        yield [ref, cell];
      }
      return;
    }

    const grid: Grid = new Map();
    for await (const [ref, cell] of this.store.range(from, to)) {
      grid.set(ref, cell);
      yield [ref, cell];
    }

    this.cache.setRange(`${from}:${to}`, grid);
  }

  [Symbol.asyncIterator](): AsyncIterator<[Ref, Cell]> {
    return this.store[Symbol.asyncIterator]();
  }
}
