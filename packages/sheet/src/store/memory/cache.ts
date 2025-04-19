import {
  inRange,
  isIntersect,
  isRangeInRange,
  toRefs,
  toSref,
} from '../../worksheet/coordinates';
import { Cell, Grid, Range, Ref } from '../../worksheet/types';

/**
 * `Cache` class represents a simple in-memory cache.
 * It is used to cache the cell values.
 */
export class Cache {
  private grids: Array<{ range: Range; grid: Grid }>;

  constructor() {
    // TODO(hackerwins): Introduce a LRU cache.
    // TODO(hackerwins): Introduce merge strategy for grids.
    this.grids = [];
  }

  /**
   * `set` method sets the cell value in the cache.
   */
  set(ref: Ref, value: Cell) {
    let grid = this.grids.find((grid) => inRange(ref, grid.range));
    grid?.grid.set(toSref(ref), value);
  }

  /**
   * `get` method returns the cell value from the cache.
   */
  get(ref: Ref): Cell | undefined {
    let grid = this.grids.find((grid) => inRange(ref, grid.range));
    return grid?.grid.get(toSref(ref));
  }

  /**
   * `has` method returns true if the cache has the cell value.
   */
  has(ref: Ref): boolean {
    let grid = this.grids.find((grid) => inRange(ref, grid.range));
    return grid?.grid.has(toSref(ref)) ?? false;
  }

  /**
   * `delete` method deletes the cell value from the cache.
   */
  delete(ref: Ref): boolean {
    let grid = this.grids.find((grid) => inRange(ref, grid.range));
    return grid?.grid.delete(toSref(ref)) ?? false;
  }

  /**
   * `setRange` method sets the cell values in the cache.
   */
  setGrid(range: Range, grid: Grid) {
    this.grids.push({ range, grid });
  }

  /**
   * `hasRange` method returns true if the cache has the cell values in the given range.
   */
  hasRange(range: Range): boolean {
    const grid = this.grids.find((grid) => isRangeInRange(range, grid.range));
    return grid !== undefined;
  }

  /**
   * `evict` method evicts the cell values in the given range from the cache.
   */
  evict(range: Range) {
    this.grids = this.grids.filter((grid) => !isIntersect(range, grid.range));
  }

  /**
   * `range` method returns a generator that yields the cells in the given range.
   */
  async getGrid(range: Range): Promise<Grid> {
    const [from, to] = range;
    const grid: Grid = new Map();
    for (const ref of toRefs([from, to])) {
      const cell = this.get(ref);
      if (cell !== undefined) {
        grid.set(toSref(ref), cell);
      }
    }

    return grid;
  }
}
