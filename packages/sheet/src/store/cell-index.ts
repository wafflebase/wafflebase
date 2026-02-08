import { Range } from '../model/types';

/**
 * `CellIndex` provides a spatial index over populated cells using dual
 * `Map<number, Set<number>>` indices (row→cols and col→rows).
 *
 * This enables efficient range queries and navigation that scale with the
 * number of populated cells rather than the size of the range/sheet.
 */
export class CellIndex {
  private rowIndex: Map<number, Set<number>> = new Map();
  private colIndex: Map<number, Set<number>> = new Map();

  /**
   * `add` registers a cell at (row, col). O(1).
   */
  add(row: number, col: number): void {
    let cols = this.rowIndex.get(row);
    if (!cols) {
      cols = new Set();
      this.rowIndex.set(row, cols);
    }
    cols.add(col);

    let rows = this.colIndex.get(col);
    if (!rows) {
      rows = new Set();
      this.colIndex.set(col, rows);
    }
    rows.add(row);
  }

  /**
   * `remove` unregisters a cell at (row, col). O(1).
   * Cleans up empty sets to avoid memory leaks.
   */
  remove(row: number, col: number): void {
    const cols = this.rowIndex.get(row);
    if (cols) {
      cols.delete(col);
      if (cols.size === 0) {
        this.rowIndex.delete(row);
      }
    }

    const rows = this.colIndex.get(col);
    if (rows) {
      rows.delete(row);
      if (rows.size === 0) {
        this.colIndex.delete(col);
      }
    }
  }

  /**
   * `has` checks if a cell exists at (row, col). O(1).
   */
  has(row: number, col: number): boolean {
    const cols = this.rowIndex.get(row);
    return cols !== undefined && cols.has(col);
  }

  /**
   * `clear` removes all entries from both indices.
   */
  clear(): void {
    this.rowIndex.clear();
    this.colIndex.clear();
  }

  /**
   * `rebuild` replaces the index contents from an iterable of [row, col] pairs.
   */
  rebuild(entries: Iterable<[number, number]>): void {
    this.clear();
    for (const [row, col] of entries) {
      this.add(row, col);
    }
  }

  /**
   * `cellsInRange` yields [row, col] pairs for populated cells within the
   * given range. Only iterates rows that actually have data — on a 1M-row
   * sheet with 50 populated cells, this checks ~50 row entries, not 1M.
   */
  *cellsInRange(range: Range): Generator<[number, number]> {
    const [from, to] = range;
    for (const [row, cols] of this.rowIndex) {
      if (row < from.r || row > to.r) continue;
      for (const col of cols) {
        if (col >= from.c && col <= to.c) {
          yield [row, col];
        }
      }
    }
  }

  /**
   * `hasAnyInRange` returns true if any populated cell exists within the range.
   * Short-circuits on the first match.
   */
  hasAnyInRange(range: Range): boolean {
    const iter = this.cellsInRange(range);
    return !iter.next().done;
  }

  /**
   * `getOccupiedColsInRow` returns the set of occupied columns in a row,
   * or undefined if the row has no data.
   */
  getOccupiedColsInRow(row: number): Set<number> | undefined {
    return this.rowIndex.get(row);
  }

  /**
   * `getOccupiedRowsInCol` returns the set of occupied rows in a column,
   * or undefined if the column has no data.
   */
  getOccupiedRowsInCol(col: number): Set<number> | undefined {
    return this.colIndex.get(col);
  }

  /**
   * `size` returns the total number of indexed cells.
   */
  get size(): number {
    let count = 0;
    for (const cols of this.rowIndex.values()) {
      count += cols.size;
    }
    return count;
  }
}
