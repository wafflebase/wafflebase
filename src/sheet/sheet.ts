import { toReference } from './coordinates';
import { Grid, CellIndex } from './types';

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
   * `selection` is the currently selected cell.
   */
  private selection: CellIndex;

  /**
   * `constructor` creates a new `Sheet` instance.
   * @param grid optional grid to initialize the sheet.
   */
  constructor(grid?: Grid) {
    this.grid = grid || new Map();
    this.dimension = { ...InitialDimensions };
    this.selection = { row: 1, col: 1 };
  }

  /**
   * `getDimension` returns the row size of the sheet.
   */
  getDimension(): { rows: number; columns: number } {
    return this.dimension;
  }

  /**
   * `hasData` checks if the given row and column has data.
   */
  hasData(row: number, col: number): boolean {
    return this.grid.has(toReference({ row, col }));
  }

  /**
   * `getData` returns the data at the given row and column.
   */
  getData(row: number, col: number): number | undefined {
    return this.grid.get(toReference({ row, col }));
  }

  /**
   * `setData` sets the data at the given row and column.
   * @param row row index.
   * @param col column number.
   * @param data data to set.
   */
  setData(row: number, col: number, data: number): void {
    this.grid.set(toReference({ row: row, col: col }), data);
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
}
