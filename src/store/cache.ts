import {
  isRangeInRange,
  parseRef,
  parseRefRange,
  toCellIDs,
  toRef,
  toRefRange,
} from '../sheet/coordinates';
import { Ref, Cell, Grid, CellRange, RefRange } from '../sheet/types';

/**
 * `Cache` class represents a simple in-memory cache.
 * It is used to cache the cell values.
 */
export class Cache {
  private view: CellRange;
  private grid: Map<Ref, Cell>;

  constructor(grid?: Grid) {
    this.grid = grid || new Map();
    this.view = [
      { row: 0, col: 0 },
      { row: 0, col: 0 },
    ];
  }

  /**
   * `set` method sets the cell value in the cache.
   */
  set(ref: Ref, value: Cell) {
    this.grid.set(ref, value);
  }

  /**
   * `get` method returns the cell value from the cache.
   */
  get(ref: Ref): Cell | undefined {
    return this.grid.get(ref);
  }

  /**
   * `has` method returns true if the cache has the cell value.
   */
  has(ref: Ref): boolean {
    return this.grid.has(ref);
  }

  /**
   * `delete` method deletes the cell value from the cache.
   */
  delete(ref: Ref): boolean {
    return this.grid.delete(ref);
  }

  /**
   * `setRange` method sets the cell values in the cache.
   */
  setRange(range: RefRange, grid: Grid) {
    console.log(`prev:${toRefRange(this.view)}, load:${range}`);
    this.view = parseRefRange(range);
    this.grid = grid;
  }

  /**
   * `hasRange` method returns true if the cache has the cell values in the given range.
   */
  hasRange(range: RefRange): boolean {
    const cellRange = parseRefRange(range);
    return isRangeInRange(cellRange, this.view);
  }

  /**
   * `range` method returns a generator that yields the cells in the given range.
   */
  *range(from: Ref, to: Ref): Generator<[Ref, Cell]> {
    const fromID = parseRef(from);
    const toID = parseRef(to);

    for (const id of toCellIDs([fromID, toID])) {
      const ref = toRef(id);
      const cell = this.get(ref);
      if (cell !== undefined) {
        yield [ref, cell];
      }
    }
  }
}
