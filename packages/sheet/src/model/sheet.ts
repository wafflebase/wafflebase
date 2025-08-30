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
  toBorderRanges,
  isSameRange,
  mergeRanges,
} from './coordinates';
import { Grid, Cell, Ref, Sref, Range, Direction } from './types';
import { grid2string, string2grid } from './grids';

/**
 * `Dimensions` represents the dimensions of the sheet.
 * This is used when the sheet is created for the first time.
 * It represents cells from A1 to ZZZ729443.
 */
const Dimensions = { rows: 729443, columns: 18278 };

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
  constructor(store: Store) {
    this.store = store;
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
   * `copy` returns the copied content.
   */
  public async copy(): Promise<string> {
    if (!this.range) {
      return '';
    }

    const grid = await this.fetchGrid(this.range);
    return grid2string(grid);
  }

  /**
   * `paste` pastes the copied content.
   */
  public async paste(value: string): Promise<void> {
    const grid = string2grid(this.activeCell, value);
    await this.setGrid(grid);
  }

  /**
   * `hasContents` checks if the given range has contents.
   */
  async hasContents(range: Range): Promise<boolean> {
    // TODO(hackerwins): Optimize this to check with the store.
    for (const ref of toRefs(range)) {
      if (await this.store.get(ref)) {
        return true;
      }
    }

    return false;
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
  public getActiveCell(): Ref {
    return this.activeCell;
  }

  /**
   * `setActiveCell` sets the currently selected cell.
   */
  public setActiveCell(ref: Ref): void {
    this.activeCell = ref;
    this.store.updateActiveCell(ref);
  }

  /**
   * `getRange` returns the range of cells that are currently selected.
   */
  getRange(): Range | undefined {
    return this.range;
  }

  /**
   * `getPresences` returns the current user presences.
   */
  getPresences(): Array<{
    clientID: string;
    presence: { activeCell: string };
  }> {
    return this.store.getPresences();
  }

  /**
   * `getRangeOrActiveCell` returns the range of cells that are currently
   * selected. It returns the active cell as a range if the range is not set.
   */
  getRangeOrActiveCell(): Range {
    return this.range || [this.activeCell, this.activeCell];
  }

  /**
   * `selectStart` sets the start cell of the selection.
   */
  selectStart(ref: Ref): void {
    if (!inRange(ref, this.dimensionRange)) {
      return;
    }

    this.setActiveCell(ref);
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
   * `selectAll` selects all the cells in the sheet.
   */
  async selectAll(): Promise<void> {
    let prev = this.getRangeOrActiveCell();
    let curr = cloneRange(prev);

    let expanded = true;
    while (expanded) {
      expanded = false;
      for (const border of toBorderRanges(curr, this.dimensionRange)) {
        if (!(await this.hasContents(border))) {
          continue;
        }

        curr = mergeRanges(curr, border);
        expanded = true;
      }
    }

    if (isSameRange(prev, curr)) {
      this.range = cloneRange(this.dimensionRange);
      return;
    }

    this.range = curr;
  }

  /**
   * `moveToEdge` moves the selection to the content edge.
   * @param rowDelta Delta to move the activeCell in the row direction.
   * @param colDelta Delta to move the activeCell in the column direction.
   * @return boolean if the selection was moved.
   */
  async moveToEdge(direction: Direction): Promise<boolean> {
    // Move to the edge of the content.
    // If the cell is empty, move to the first non-empty cell.
    // If the cell is non-empty, move to the last non-empty cell.
    const ref = await this.store.findEdge(
      this.activeCell,
      direction,
      this.dimensionRange,
    );

    if (isSameRef(this.activeCell, ref)) {
      return false;
    }

    this.range = undefined;
    this.setActiveCell(ref);
    return true;
  }

  /**
   * `move` moves the selection by the given delta.
   * @return boolean if the selection was moved.
   */
  move(direction: Direction): boolean {
    const rowDelta = direction === 'up' ? -1 : direction === 'down' ? 1 : 0;
    const colDelta = direction === 'left' ? -1 : direction === 'right' ? 1 : 0;

    let row = this.activeCell.r + rowDelta;
    let col = this.activeCell.c + colDelta;

    if (!inRange({ r: row, c: col }, this.dimensionRange)) {
      return false;
    }

    if (isSameRef(this.activeCell, { r: row, c: col })) {
      return false;
    }

    this.range = undefined;
    this.setActiveCell({ r: row, c: col });
    return true;
  }

  /**
   * `resizeRange` resizes the range by the given delta.
   * @param rowDelta Delta to move the range in the row direction.
   * @param colDelta Delta to move the range in the column direction.
   * @param return boolean if the range was resized.
   */
  resizeRange(direction: Direction): boolean {
    const rowDelta = direction === 'up' ? -1 : direction === 'down' ? 1 : 0;
    const colDelta = direction === 'left' ? -1 : direction === 'right' ? 1 : 0;
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

    this.setActiveCell({ r: row, c: col });
  }
}
