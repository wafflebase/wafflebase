import { Cell, Grid, Ref, Range, Sref } from '../sheet/types';
import { Store } from './store';
import { createWorkerIDBStore } from './idb/workeridb';
import { Cache } from './memory/cache';
import { expandRange } from '../sheet/coordinates';

export async function createStore(key: string): Promise<LocalStore> {
  const idb = await createWorkerIDBStore(key);
  return new LocalStore(idb);
}

/**
 * `ExpandRate` is the rate to expand the range when fetching the grid.
 */
const ExpandRate = 10;

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
    if (this.cache.hasRange([ref, ref])) {
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
    if (this.cache.hasRange([ref, ref])) {
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

  async getGrid(range: Range): Promise<Grid> {
    if (this.cache.hasRange(range)) {
      return this.cache.getGrid(range);
    }

    const expandedRange = expandRange(range, ExpandRate);
    const grid = await this.store.getGrid(expandedRange);
    this.cache.setGrid(expandedRange, grid);
    return grid;
  }

  async buildDependantsMap(
    srefs: Iterable<Sref>,
  ): Promise<Map<Sref, Set<Sref>>> {
    return this.store.buildDependantsMap(srefs);
  }
}
