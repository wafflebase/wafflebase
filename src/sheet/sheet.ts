import { toReference } from './coordinates';
import { Grid } from './types';

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
   * `constructor` creates a new `Sheet` instance.
   * @param grid optional grid to initialize the sheet.
   */
  constructor(grid?: Grid) {
    this.grid = grid || new Map();
    this.dimension = { ...InitialDimensions };
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
}
