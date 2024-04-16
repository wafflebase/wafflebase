import { extractReferences } from '../formula/formula';
import { calculate } from './calculator';
import { toRef, toRefs } from './coordinates';
import { Grid, Cell, CellID, Ref } from './types';

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
   * `dependantsMap` is a map that represents dependants of cells.
   *
   * TODO(hackerwins): We need to move this map to spreadsheet level, because references
   * can be across sheets.
   */
  private dependantsMap: Map<Ref, Set<Ref>>;

  /**
   * `dimension` is the dimensions of the sheet that are currently visible.
   */
  private dimension: { rows: number; columns: number };

  /**
   * `selection` is the currently selected cell.
   */
  private selection: CellID;

  /**
   * `constructor` creates a new `Sheet` instance.
   * @param grid optional grid to initialize the sheet.
   */
  constructor(grid?: Grid) {
    this.grid = grid || new Map();
    this.dependantsMap = new Map();
    this.dimension = { ...InitialDimensions };
    this.selection = { row: 1, col: 1 };

    this.buildDependantsMap();
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
  getCell(ref: Ref) {
    return this.grid.get(ref);
  }

  /**
   * `setCell` sets the cell at the given row and column.
   */
  setCell(ref: Ref, cell: Cell) {
    this.grid.set(ref, cell);
  }

  /**
   * `hasData` checks if the given row and column has data.
   */
  hasData(index: CellID): boolean {
    return this.grid.has(toRef(index));
  }

  /**
   * `hasFormula` checks if the given row and column has a formula.
   */
  hasFormula(ref: Ref): boolean {
    const cell = this.grid.get(ref);
    return cell && cell.f ? true : false;
  }

  /**
   * `hasDependants` checks if the given row and column has dependants.
   */
  hasDependants(ref: Ref): boolean {
    return this.dependantsMap.has(ref);
  }

  /**
   * `getDependants` returns the dependants of the given row and column.
   */
  getDependants(ref: Ref): Set<Ref> | undefined {
    return this.dependantsMap.get(ref);
  }

  /**
   * `toInputString` returns the input string at the given row and column.
   */
  toInputString(index: CellID): string {
    const cell = this.grid.get(toRef(index));
    return !cell ? '' : cell.f ? cell.f : cell.v || '';
  }

  /**
   * `toDisplayString` returns the display string at the given row and column.
   */
  toDisplayString(index: CellID): string {
    const cell = this.grid.get(toRef(index));
    return (cell && cell.v) || '';
  }

  /**
   * `setData` sets the data at the given row and column.
   */
  setData(index: CellID, value: string): void {
    const reference = toRef(index);

    // 01. Update the cell with the new value.
    const cell = value.startsWith('=') ? { f: value } : { v: value };
    this.grid.set(reference, cell);

    // 02. Update the dependencies.
    if (value.startsWith('=')) {
      for (const ref of toRefs(extractReferences(value))) {
        if (!this.dependantsMap.has(ref)) {
          this.dependantsMap.set(ref, new Set());
        }
        this.dependantsMap.get(ref)!.add(reference);
      }
    }

    // 03. Calculate the cell and its dependencies.
    calculate(this, reference);
  }

  /**
   * `removeData` removes the data at the given row and column.
   */
  removeData(id: CellID): boolean {
    const updated = this.grid.delete(toRef(id));
    calculate(this, toRef(id));
    return updated;
  }

  /**
   * `getSelection` returns the currently selected cell.
   */
  getSelection(): CellID {
    return this.selection;
  }

  /**
   * `setSelection` sets the selection to the given cell.
   */
  setSelection(selection: CellID) {
    if (
      selection.row < 1 ||
      selection.col < 1 ||
      selection.row > this.dimension.rows ||
      selection.col > this.dimension.columns
    ) {
      return;
    }
    this.selection = selection;
  }

  /**
   * `moveSelection` moves the selection by the given delta.
   * @param rowDelta Delta to move the selection in the row direction.
   * @param colDelta Delta to move the selection in the column direction.
   */
  moveSelection(rowDelta: number, colDelta: number) {
    let newRow = this.selection.row + rowDelta;
    let newCol = this.selection.col + colDelta;

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
    this.selection = { row: newRow, col: newCol };
  }

  /**
   * `buildDependencies` builds the entire dependency graph.
   */
  private buildDependantsMap() {
    for (const [ref, cell] of this.grid) {
      if (!cell.f) {
        continue;
      }

      const references = extractReferences(cell.f);
      for (const reference of toRefs(references)) {
        if (!this.dependantsMap.has(reference)) {
          this.dependantsMap.set(reference, new Set());
        }
        this.dependantsMap.get(reference)!.add(ref);
      }
    }
  }
}
