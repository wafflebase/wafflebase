import { extractReferences } from '../formula/formula';
import { calculate } from './calculator';
import { toReference } from './coordinates';
import { Grid, Cell, CellIndex, Reference } from './types';

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
  private dependantsMap: Map<Reference, Set<Reference>>;

  /**
   * `dimension` is the dimensions of the sheet that are currently visible.
   */
  private dimension: { rows: number; columns: number };

  /**
   * `selection` is the currently selected cell.
   */
  private selection: CellIndex;

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
  getCell(ref: Reference) {
    return this.grid.get(ref);
  }

  /**
   * `setCell` sets the cell at the given row and column.
   */
  setCell(ref: Reference, cell: Cell) {
    this.grid.set(ref, cell);
  }

  /**
   * `hasData` checks if the given row and column has data.
   */
  hasData(index: CellIndex): boolean {
    return this.grid.has(toReference(index));
  }

  /**
   * `hasFormula` checks if the given row and column has a formula.
   */
  hasFormula(ref: Reference): boolean {
    const cell = this.grid.get(ref);
    return cell && cell.f ? true : false;
  }

  /**
   * `hasDependants` checks if the given row and column has dependants.
   */
  hasDependants(ref: Reference): boolean {
    return this.dependantsMap.has(ref);
  }

  /**
   * `getDependants` returns the dependants of the given row and column.
   */
  getDependants(ref: Reference): Set<Reference> | undefined {
    return this.dependantsMap.get(ref);
  }

  /**
   * `toInputString` returns the input string at the given row and column.
   */
  toInputString(index: CellIndex): string {
    const cell = this.grid.get(toReference(index));
    return !cell ? '' : cell.f ? cell.f : cell.v || '';
  }

  /**
   * `toDisplayString` returns the display string at the given row and column.
   */
  toDisplayString(index: CellIndex): string {
    const cell = this.grid.get(toReference(index));
    return (cell && cell.v) || '';
  }

  /**
   * `setData` sets the data at the given row and column.
   */
  setData(index: CellIndex, value: string): void {
    const reference = toReference(index);

    // 01. Update the cell with the new value.
    const cell = value.startsWith('=') ? { f: value } : { v: value };
    this.grid.set(reference, cell);

    // 02. Update the dependencies.
    if (value.startsWith('=')) {
      const refs = extractReferences(value);
      for (const ref of refs) {
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
  removeData(index: CellIndex): boolean {
    const updated = this.grid.delete(toReference(index));
    calculate(this, toReference(index));
    return updated;
  }

  /**
   * `getSelection` returns the currently selected cell.
   */
  getSelection(): CellIndex {
    return this.selection;
  }

  /**
   * `setSelection` sets the selection to the given cell.
   */
  setSelection(selection: CellIndex) {
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
    for (const [reference, cell] of this.grid) {
      if (!cell.f) {
        continue;
      }

      const refs = extractReferences(cell.f);
      for (const ref of refs) {
        if (!this.dependantsMap.has(ref)) {
          this.dependantsMap.set(ref, new Set());
        }
        this.dependantsMap.get(ref)!.add(reference);
      }
    }
  }
}
