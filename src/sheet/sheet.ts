import { extractReferences } from '../formula/formula';
import { MemStore } from '../store/memory/memory';
import { Store } from '../store/store';
import { calculate } from './calculator';
import {
  cloneRange,
  inRange,
  isRangeInRange,
  isSameRef,
  toRefs,
  toRange,
  toSref,
  toSrefs,
  parseRef,
} from './coordinates';
import { Grid, Cell, Ref, Sref, Range } from './types';

/**
 * `Dimensions` represents the dimensions of the sheet.
 * This is used when the sheet is created for the first time.
 * The sheet will have 720000 rows and 16384 columns. A1:XFD720000
 */
const Dimensions = { rows: 720000, columns: 16384 };

/**
 * `Sheet` class represents a sheet with rows and columns.
 */
export class Sheet {
  /**
   * `grid` is a 2D grid that represents the sheet.
   */
  private store: Store;

  /**
   * `dimension` is the dimensions of the sheet that are currently visible.
   */
  private dimension: { rows: number; columns: number };

  /**
   * `activeCell` is the currently selected cell.
   */
  private activeCell: Ref;

  /**
   * `range` is the range of cells that are currently selected.
   */
  private range?: [Ref, Ref];

  /**
   * `constructor` creates a new `Sheet` instance.
   * @param grid optional grid to initialize the sheet.
   */
  constructor(store?: Store) {
    this.store = store || new MemStore();
    this.dimension = { ...Dimensions };
    this.activeCell = { r: 1, c: 1 };
  }

  /**
   * `getDimensionRange` returns the range of the dimensions.
   */
  get dimensionRange(): Range {
    return [
      { r: 1, c: 1 },
      { r: this.dimension.rows, c: this.dimension.columns },
    ];
  }

  /**
   * `getDimension` returns the row size of the sheet.
   */
  getDimension(): { rows: number; columns: number } {
    return this.dimension;
  }

  /**
   * `getCell` returns the cell at the given row and column.
   */
  async getCell(ref: Ref): Promise<Cell | undefined> {
    return this.store.get(ref);
  }

  /**
   * `setCell` sets the cell at the given row and column.
   */
  async setCell(ref: Ref, cell: Cell): Promise<void> {
    await this.store.set(ref, cell);
  }

  /**
   * `setGrid` sets the grid of cells.
   */
  async setGrid(grid: Grid): Promise<void> {
    await this.store.setGrid(grid);
  }

  /**
   * `hasFormula` checks if the given row and column has a formula.
   */
  async hasFormula(ref: Ref): Promise<boolean> {
    const cell = await this.store.get(ref);
    return cell && cell.f ? true : false;
  }

  /**
   * `toInputString` returns the input string at the given row and column.
   */
  async toInputString(ref: Ref): Promise<string> {
    const cell = await this.store.get(ref);
    return !cell ? '' : cell.f ? cell.f : cell.v || '';
  }

  /**
   * `toDisplayString` returns the display string at the given row and column.
   */
  async toDisplayString(ref: Ref): Promise<string> {
    const cell = await this.store.get(ref);
    return (cell && cell.v) || '';
  }

  /**
   * `recalculate` recalculates the entire sheet.
   * TODO(hackerwins): Optimize this.
   */
  async recalculate(): Promise<void> {
    const srefs = new Set<Sref>();
    for await (const [ref] of this.store) {
      if (await this.hasFormula(ref)) {
        srefs.add(toSref(ref));
      }
    }

    const dependantsMap = await this.store.buildDependantsMap(srefs);
    await calculate(this, dependantsMap, srefs);
  }

  /**
   * `setData` sets the data at the given row and column.
   */
  async setData(ref: Ref, value: string): Promise<void> {
    // 01. Update the cell with the new value.
    const cell = value.startsWith('=') ? { f: value } : { v: value };
    await this.store.set(ref, cell);

    // 02. Update the dependencies.
    const dependantsMap = await this.store.buildDependantsMap([toSref(ref)]);

    // 03. Calculate the cell and its dependencies.
    await calculate(this, dependantsMap, [toSref(ref)]);
  }

  /**
   * `removeData` removes the data at the given row and column.
   */
  async removeData(): Promise<boolean> {
    const removeds = new Set<Sref>();
    for (const ref of this.toSelecteds()) {
      if (await this.store.delete(ref)) {
        removeds.add(toSref(ref));
      }
    }

    const dependantsMap = await this.store.buildDependantsMap(removeds);
    await calculate(this, dependantsMap, removeds);

    return removeds.size > 0;
  }

  /**
   * `createGrid` fetches the grid by the given range.
   */
  async fetchGrid(range: Range): Promise<Grid> {
    return this.store.getGrid(range);
  }

  /**
   * `fetchGridByReferences` fetches the grid by the given references.
   */
  async fetchGridByReferences(references: Set<Sref>): Promise<Grid> {
    const grid = new Map<Sref, Cell>();
    for (const sref of toSrefs(references)) {
      const cell = await this.store.get(parseRef(sref));
      if (!cell) {
        continue;
      }

      grid.set(sref, cell);
    }

    return grid;
  }

  /**
   * `toSelecteds` returns the selected refs.
   */
  *toSelecteds(): Generator<Ref> {
    if (!this.range) {
      yield this.activeCell;
      return;
    }

    for (const ref of toRefs(this.range)) {
      yield ref;
    }
  }

  /**
   * `getActiveCell` returns the currently selected cell.
   */
  getActiveCell(): Ref {
    return this.activeCell;
  }

  /**
   * `getRange` returns the range of cells that are currently selected.
   */
  getRange(): Range | undefined {
    return this.range;
  }

  /**
   * `selectStart` sets the start cell of the selection.
   */
  selectStart(ref: Ref): void {
    if (!inRange(ref, this.dimensionRange)) {
      return;
    }

    this.activeCell = ref;
    this.range = undefined;
  }

  /**
   * `selectEnd` sets the end cell of the selection.
   */
  selectEnd(ref: Ref): void {
    if (!inRange(ref, this.dimensionRange)) {
      return;
    }

    if (isSameRef(this.activeCell, ref)) {
      this.range = undefined;
      return;
    }

    this.range = toRange(this.activeCell, ref);
  }

  /**
   * `hasRange` checks if the sheet has a range selected.
   */
  hasRange(): boolean {
    return !!this.range;
  }

  /**
   * `moveToEdge` moves the selection to the content edge.
   * @param rowDelta Delta to move the activeCell in the row direction.
   * @param colDelta Delta to move the activeCell in the column direction.
   * @return boolean if the selection was moved.
   */
  async moveToEdge(rowDelta: number, colDelta: number): Promise<boolean> {
    let row = this.activeCell.r;
    let col = this.activeCell.c;

    let first = true;
    let prev = true;
    while (true) {
      const nextRow = row + rowDelta;
      const nextCol = col + colDelta;

      if (!inRange({ r: nextRow, c: nextCol }, this.dimensionRange)) {
        break;
      }

      const curr = await this.store.has({ r: row, c: col });
      const next = await this.store.has({ r: nextRow, c: nextCol });

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

    if (isSameRef(this.activeCell, { r: row, c: col })) {
      return false;
    }

    this.range = undefined;
    this.activeCell = { r: row, c: col };
    return true;
  }

  /**
   * `move` moves the selection by the given delta.
   * @param rowDelta Delta to move the activeCell in the row direction.
   * @param colDelta Delta to move the activeCell in the column direction.
   * @return boolean if the selection was moved.
   */
  move(rowDelta: number, colDelta: number): boolean {
    let row = this.activeCell.r + rowDelta;
    let col = this.activeCell.c + colDelta;

    if (!inRange({ r: row, c: col }, this.dimensionRange)) {
      return false;
    }

    if (isSameRef(this.activeCell, { r: row, c: col })) {
      return false;
    }

    this.range = undefined;
    this.activeCell = { r: row, c: col };
    return true;
  }

  /**
   * `resizeRange` resizes the range by the given delta.
   * @param rowDelta Delta to move the range in the row direction.
   * @param colDelta Delta to move the range in the column direction.
   * @param return boolean if the range was resized.
   */
  resizeRange(rowDelta: number, colDelta: number): boolean {
    let range = cloneRange(this.range || [this.activeCell, this.activeCell]);

    if (this.activeCell.r === range[1].r) {
      range[0].r += rowDelta;
    } else {
      range[1].r += rowDelta;
    }

    if (this.activeCell.c === range[1].c) {
      range[0].c += colDelta;
    } else {
      range[1].c += colDelta;
    }

    range = toRange(range[0], range[1]);
    if (!isRangeInRange(range, this.dimensionRange)) {
      return false;
    }

    this.range = range;
    return true;
  }

  /**
   * `moveInRange` moves the id within the given range.
   * @param rowDelta Delta to move the activeCell in the row direction.
   * @param colDelta Delta to move the activeCell in the column direction.
   */
  moveInRange(rowDelta: number, colDelta: number): void {
    const range = this.range || this.dimensionRange;

    let row = this.activeCell.r;
    let col = this.activeCell.c;
    const rows = range[1].r - range[0].r + 1;
    const cols = range[1].c - range[0].c + 1;
    if (rowDelta !== 0) {
      if (row + rowDelta > range[1].r) {
        row = range[0].r;
        col = ((col + 1 - range[0].c + cols) % cols) + range[0].c;
      } else if (row + rowDelta < range[0].r) {
        row = range[1].r;
        col = ((col - 1 - range[0].c + cols) % cols) + range[0].c;
      } else {
        row += rowDelta;
      }
    }

    if (colDelta !== 0) {
      if (col + colDelta > range[1].c) {
        col = range[0].c;
        row = ((row + 1 - range[0].r + rows) % rows) + range[0].r;
      } else if (col + colDelta < range[0].c) {
        col = range[1].c;
        row = ((row - 1 - range[0].r + rows) % rows) + range[0].r;
      } else {
        col += colDelta;
      }
    }

    this.activeCell = { r: row, c: col };
  }
}
