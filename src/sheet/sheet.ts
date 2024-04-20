import { extractReferences } from '../formula/formula';
import { calculate } from './calculator';
import {
  cloneRange,
  inRange,
  isRangeInRange,
  isSameID,
  toCellIDs,
  toRange,
  toRef,
  toRefs,
} from './coordinates';
import { Grid, Cell, CellID, Ref, CellRange } from './types';

/**
 * `InitialDimensions` represents the initial dimensions of the sheet.
 * This is used when the sheet is created for the first time.
 * The sheet will have 100 rows and 26 columns. A1:Z100
 */
const InitialDimensions = { rows: 100, columns: 26 };

/**
 * `Sheet` class represents a sheet with rows and columns.
 */
export class Sheet {
  /**
   * `grid` is a 2D grid that represents the sheet.
   */
  private grid: Grid;

  /**
   * `dimension` is the dimensions of the sheet that are currently visible.
   */
  private dimension: { rows: number; columns: number };

  /**
   * `activeCell` is the currently selected cell.
   */
  private activeCell: CellID;

  /**
   * `range` is the range of cells that are currently selected.
   */
  private range?: [CellID, CellID];

  /**
   * `constructor` creates a new `Sheet` instance.
   * @param grid optional grid to initialize the sheet.
   */
  constructor(grid?: Grid) {
    this.grid = grid || new Map();
    this.dimension = { ...InitialDimensions };
    this.activeCell = { row: 1, col: 1 };
  }

  /**
   * `getDimensionRange` returns the range of the dimensions.
   */
  get dimensionRange(): CellRange {
    return [
      { row: 1, col: 1 },
      { row: this.dimension.rows, col: this.dimension.columns },
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
  getCell(ref: Ref): Cell | undefined {
    return this.grid.get(ref);
  }

  /**
   * `setCell` sets the cell at the given row and column.
   */
  setCell(ref: Ref, cell: Cell): void {
    this.grid.set(ref, cell);
  }

  /**
   * `hasFormula` checks if the given row and column has a formula.
   */
  hasFormula(ref: Ref): boolean {
    const cell = this.grid.get(ref);
    return cell && cell.f ? true : false;
  }

  /**
   * `toInputString` returns the input string at the given row and column.
   */
  toInputString(ref: Ref): string {
    const cell = this.grid.get(ref);
    return !cell ? '' : cell.f ? cell.f : cell.v || '';
  }

  /**
   * `toDisplayString` returns the display string at the given row and column.
   */
  toDisplayString(ref: Ref): string {
    const cell = this.grid.get(ref);
    return (cell && cell.v) || '';
  }

  /**
   * `setData` sets the data at the given row and column.
   */
  setData(id: CellID, value: string): void {
    const ref = toRef(id);

    // 01. Update the cell with the new value.
    const cell = value.startsWith('=') ? { f: value } : { v: value };
    this.grid.set(ref, cell);

    // 02. Update the dependencies.
    const dependantsMap = this.buildDependantsMap();

    // 03. Calculate the cell and its dependencies.
    calculate(this, dependantsMap, ref);
  }

  /**
   * `removeData` removes the data at the given row and column.
   */
  removeData(): boolean {
    let updated = false;
    for (const id of this.toSelectedID()) {
      if (this.grid.delete(toRef(id))) {
        updated = true;
      }

      // TODO(hackerwins): Optimize this to only calculate the affected cells.
      const dependantsMap = this.buildDependantsMap();
      calculate(this, dependantsMap, toRef(id));
    }
    return updated;
  }

  /**
   * `toSelectedID` returns the selected cell or range of cells.
   */
  *toSelectedID(): Generator<CellID> {
    if (!this.range) {
      yield this.activeCell;
      return;
    }

    for (const id of toCellIDs(this.range)) {
      yield id;
    }
  }

  /**
   * `getActiveCell` returns the currently selected cell.
   */
  getActiveCell(): CellID {
    return this.activeCell;
  }

  /**
   * `getRange` returns the range of cells that are currently selected.
   */
  getRange(): CellRange | undefined {
    return this.range;
  }

  /**
   * `selectStart` sets the start cell of the selection.
   */
  selectStart(id: CellID): void {
    if (!inRange(id, this.dimensionRange)) {
      return;
    }

    this.activeCell = id;
    this.range = undefined;
  }

  /**
   * `selectEnd` sets the end cell of the selection.
   */
  selectEnd(id: CellID): void {
    if (!inRange(id, this.dimensionRange)) {
      return;
    }

    if (isSameID(this.activeCell, id)) {
      this.range = undefined;
      return;
    }

    this.range = toRange(this.activeCell, id);
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
  moveToEdge(rowDelta: number, colDelta: number): boolean {
    let row = this.activeCell.row;
    let col = this.activeCell.col;
    const fromData = this.grid.has(toRef(this.activeCell));

    // TODO(hackerwins): If the active cell is contents edge, move to the next
    // cell even if it is empty.
    while (true) {
      const nextRow = row + rowDelta;
      const nextCol = col + colDelta;

      if (!inRange({ row: nextRow, col: nextCol }, this.dimensionRange)) {
        break;
      }

      if (fromData && !this.grid.has(toRef({ row: nextRow, col: nextCol }))) {
        break;
      }

      row = nextRow;
      col = nextCol;

      if (!fromData && this.grid.has(toRef({ row: nextRow, col: nextCol }))) {
        break;
      }
    }

    if (isSameID(this.activeCell, { row, col })) {
      return false;
    }

    this.range = undefined;
    this.activeCell = { row, col };
    return true;
  }
  /**
   * `move` moves the selection by the given delta.
   * @param rowDelta Delta to move the activeCell in the row direction.
   * @param colDelta Delta to move the activeCell in the column direction.
   * @return boolean if the selection was moved.
   */
  move(rowDelta: number, colDelta: number): boolean {
    let row = this.activeCell.row + rowDelta;
    let col = this.activeCell.col + colDelta;

    if (!inRange({ row, col }, this.dimensionRange)) {
      return false;
    }

    if (isSameID(this.activeCell, { row, col })) {
      return false;
    }

    this.range = undefined;
    this.activeCell = { row, col };
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

    if (this.activeCell.row === range[1].row) {
      range[0].row += rowDelta;
    } else {
      range[1].row += rowDelta;
    }

    if (this.activeCell.col === range[1].col) {
      range[0].col += colDelta;
    } else {
      range[1].col += colDelta;
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

    let row = this.activeCell.row;
    let col = this.activeCell.col;
    const rows = range[1].row - range[0].row + 1;
    const cols = range[1].col - range[0].col + 1;
    if (rowDelta !== 0) {
      if (row + rowDelta > range[1].row) {
        row = range[0].row;
        col = ((col + 1 - range[0].col + cols) % cols) + range[0].col;
      } else if (row + rowDelta < range[0].row) {
        row = range[1].row;
        col = ((col - 1 - range[0].col + cols) % cols) + range[0].col;
      } else {
        row += rowDelta;
      }
    }

    if (colDelta !== 0) {
      if (col + colDelta > range[1].col) {
        col = range[0].col;
        row = ((row + 1 - range[0].row + rows) % rows) + range[0].row;
      } else if (col + colDelta < range[0].col) {
        col = range[1].col;
        row = ((row - 1 - range[0].row + rows) % rows) + range[0].row;
      } else {
        col += colDelta;
      }
    }

    this.activeCell = { row, col };
  }

  /**
   * `buildDependencies` builds the entire dependency graph.
   */
  private buildDependantsMap(): Map<Ref, Set<Ref>> {
    const dependantsMap = new Map();

    for (const [ref, cell] of this.grid) {
      if (!cell.f) {
        continue;
      }

      for (const r of toRefs(extractReferences(cell.f))) {
        if (!dependantsMap.has(r)) {
          dependantsMap.set(r, new Set());
        }
        dependantsMap.get(r)!.add(ref);
      }
    }
    return dependantsMap;
  }
}
