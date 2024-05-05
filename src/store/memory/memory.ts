import { extractReferences } from '../../formula/formula';
import { inRange, parseRef, toSref, toSrefs } from '../../sheet/coordinates';
import { Cell, Grid, Ref, Range, Sref } from '../../sheet/types';

/**
 * `MemStore` class represents an in-memory storage.
 * It is used in testing and development.
 */
export class MemStore {
  private grid: Map<Sref, Cell>;

  constructor(grid?: Grid) {
    this.grid = grid || new Map();
  }

  async set(ref: Ref, value: Cell) {
    this.grid.set(toSref(ref), value);
  }

  async get(ref: Ref): Promise<Cell | undefined> {
    return this.grid.get(toSref(ref));
  }

  async has(ref: Ref): Promise<boolean> {
    return this.grid.has(toSref(ref));
  }

  async delete(ref: Ref): Promise<boolean> {
    return this.grid.delete(toSref(ref));
  }

  async setGrid(grid: Grid): Promise<void> {
    for (const [sref, cell] of grid) {
      this.grid.set(sref, cell);
    }
  }

  async getGrid(range: Range): Promise<Grid> {
    const entries = this.grid.entries();
    const grid: Grid = new Map();

    for (const [sref, value] of entries) {
      const ref = parseRef(sref);
      if (inRange(ref, range)) {
        grid.set(sref, value);
      }
    }
    return Promise.resolve(grid);
  }

  /**
   * `buildDependantsMap` method builds a map of dependants. Unlike the
   * `IDBStore` implementation, this builds the map from the entire grid.
   */
  async buildDependantsMap(_: Array<Sref>): Promise<Map<Sref, Set<Sref>>> {
    const entries = Array.from(this.grid.entries());

    const dependantsMap = new Map<Sref, Set<Sref>>();
    for (const [ref, cell] of entries) {
      if (!cell.f) {
        continue;
      }

      for (const r of toSrefs(extractReferences(cell.f))) {
        if (!dependantsMap.has(r)) {
          dependantsMap.set(r, new Set());
        }
        dependantsMap.get(r)!.add(ref);
      }
    }
    return dependantsMap;
  }
}
