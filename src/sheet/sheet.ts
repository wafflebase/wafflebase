import { evaluate, extractReferences } from '../formula/formula';
import { toReference } from './coordinates';
import { Grid, CellIndex, Reference } from './types';

/**
 * `InitialDimensions` represents the initial dimensions of the sheet.
 * This is used when the sheet is created for the first time.
 * The sheet will have 100 rows and 26 columns. A1:Z100
 */
const InitialDimensions = { rows: 100, columns: 26 };

/**
 * `CalculationError` represents an error that occurs during calculation.
 */
class CalculationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CalculationError';
  }
}

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
   * `hasData` checks if the given row and column has data.
   */
  hasData(index: CellIndex): boolean {
    return this.grid.has(toReference(index));
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

    this.calculate(reference);
  }

  /**
   * `removeData` removes the data at the given row and column.
   */
  removeData(index: CellIndex): boolean {
    const updated = this.grid.delete(toReference(index));
    this.calculate(toReference(index));
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

  /**
   * `calculate` calculates recursively the given cell and its dependencies.
   */
  private calculate(reference: string) {
    try {
      for (const ref of this.topologicalSort(reference)) {
        const cell = this.grid.get(ref);
        if (!cell || !cell.f) {
          continue;
        }

        const value = evaluate(cell.f, this);
        this.grid.set(ref, {
          v: value.toString(),
          f: cell.f,
        });
      }
    } catch (error) {
      if (error instanceof CalculationError) {
        const cell = this.grid.get(reference);
        if (cell) {
          this.grid.set(reference, {
            v: '#REF!',
            f: cell.f,
          });
        }
        return;
      }

      throw error;
    }
  }

  /**
   * `topologicalSort` returns the topological sort of the dependencies.
   */
  private topologicalSort(reference: Reference): Array<Reference> {
    const sorted: Array<Reference> = [reference];
    const visited = new Set<Reference>();
    const stack = new Set<Reference>();

    const dfs = (ref: Reference) => {
      if (stack.has(ref)) {
        throw new CalculationError('Circular reference detected');
      }

      stack.add(ref);

      if (!visited.has(ref)) {
        visited.add(ref);

        if (this.dependantsMap.has(ref)) {
          for (const dependant of this.dependantsMap.get(ref)!) {
            dfs(dependant);
          }
        }
        sorted.push(ref);
      }

      stack.delete(ref);
    };

    dfs(reference);
    return sorted.reverse();
  }
}
