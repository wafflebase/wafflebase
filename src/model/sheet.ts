import { generateCellIndices, parseRangeReference } from "./coordinates";
import { Grid } from "./types";

/**
 * `Sheet` class represents a sheet with rows and columns.
 */
export class Sheet {
  private grid: Grid;

  /**
   * Creates a new `Sheet` instance.
   * @param rows Number of rows in the sheet.
   * @param columns Number of columns in the sheet.
   */
  constructor(rows: number) {
    this.grid = new Map();

    for (let rowIndex = 1; rowIndex <= rows; rowIndex++) {
      this.grid.set(rowIndex, new Map());
    }
  }

  /**
   * Adds a new row to the sheet.
   */
  addRow(): void {
    this.grid.set(this.grid.size, new Map());
  }

  /**
   * setData sets the data at the given row and column.
   * @param rowIndex row index.
   * @param columnIndex column number.
   * @param data data to set.
   */
  setData(rowIndex: number, columnIndex: number, data: number): void {
    if (!this.grid.has(rowIndex)) {
      throw new Error(`Row ${rowIndex} does not exist`);
    }

    const row = this.grid.get(rowIndex)!;
    row.set(columnIndex, data);
  }

  /**
   * calculateSum calculates the sum of the sheet based on the given reference.
   *
   * @param rangeReference range reference. e.g. "A1:B2"
   * @return sum of the cells.
   */
  calculateSum(rangeReference: string): number {
    const [fromIndex, toIndex] = parseRangeReference(rangeReference);
    let sum = 0;
    for (let cellIndex of generateCellIndices(fromIndex, toIndex)) {
      const cell = this.grid.get(cellIndex.row)?.get(cellIndex.col) ?? 0;
      sum += cell;
    }

    return sum;
  }
}
