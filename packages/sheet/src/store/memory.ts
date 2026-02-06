import { extractReferences } from '../formula/formula';
import { inRange, parseRef, toSref, toSrefs } from '../model/coordinates';
import { shiftGrid } from '../model/shifting';
import { Axis, Cell, Grid, Ref, Range, Sref, Direction } from '../model/types';
import { Store } from './store';

/**
 * `MemStore` class represents an in-memory storage.
 * It is used in testing and development.
 */
export class MemStore implements Store {
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
   * `findEdge` method finds the edge of the grid.
   */
  async findEdge(
    ref: Ref,
    direction: Direction,
    dimension: Range,
  ): Promise<Ref> {
    let row = ref.r;
    let col = ref.c;

    const rowDelta = direction === 'up' ? -1 : direction === 'down' ? 1 : 0;
    const colDelta = direction === 'left' ? -1 : direction === 'right' ? 1 : 0;

    let first = true;
    let prev = true;
    while (true) {
      const nextRow = row + rowDelta;
      const nextCol = col + colDelta;

      if (!inRange({ r: nextRow, c: nextCol }, dimension)) {
        break;
      }

      const curr = await this.has({ r: row, c: col });
      const next = await this.has({ r: nextRow, c: nextCol });

      if (!prev && curr) {
        break;
      }
      if (!first && curr && !next) {
        break;
      }

      prev = curr;
      first = false;

      row = nextRow;
      col = nextCol;
    }

    return { r: row, c: col };
  }

  async shiftCells(axis: Axis, index: number, count: number): Promise<void> {
    this.grid = shiftGrid(this.grid, axis, index, count);
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

  /**
   * `getPresences` method gets the user presences.
   * For MemStore, this returns an empty array since it's not connected to real-time collaboration.
   */
  getPresences(): Array<{
    clientID: string;
    presence: { activeCell: string };
  }> {
    return [];
  }

  /**
   * `updateActiveCell` method updates the active cell of the current user.
   * For MemStore, this is a no-op since it's not connected to real-time collaboration.
   */
  updateActiveCell(_: Ref): void {
    // No-op for memory store
  }
}
