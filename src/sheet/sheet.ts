import { extractReferences } from '../formula/formula';
import { calculate } from './calculator';
import { isSameID, toRef, toRefs } from './coordinates';
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
  removeData(id: CellID): boolean {
    const updated = this.grid.delete(toRef(id));
    const dependantsMap = this.buildDependantsMap();
    calculate(this, dependantsMap, toRef(id));
    return updated;
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
    if (
      id.row < 1 ||
      id.col < 1 ||
      id.row > this.dimension.rows ||
      id.col > this.dimension.columns
    ) {
      return;
    }
    this.activeCell = id;
    this.range = undefined;
  }

  /**
   * `selectEnd` sets the end cell of the selection.
   */
  selectEnd(id: CellID): void {
    if (
      id.row < 1 ||
      id.col < 1 ||
      id.row > this.dimension.rows ||
      id.col > this.dimension.columns
    ) {
      return;
    }

    if (isSameID(this.activeCell, id)) {
      this.range = undefined;
      return;
    }

    this.range = [this.activeCell, id];
  }

  /**
   * `moveActiveCell` moves the selection by the given delta.
   * @param rowDelta Delta to move the activeCell in the row direction.
   * @param colDelta Delta to move the activeCell in the column direction.
   */
  moveActiveCell(rowDelta: number, colDelta: number): void {
    let newRow = this.activeCell.row + rowDelta;
    let newCol = this.activeCell.col + colDelta;

    if (newRow < 1) {
      newRow = 1;
    } else if (newRow > this.dimension.rows) {
      newRow = this.dimension.rows;
    }

    if (newCol < 1) {
      newCol = 1;
    } else if (newCol > this.dimension.columns) {
      newCol = this.dimension.columns;
    }
    this.activeCell = { row: newRow, col: newCol };
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
