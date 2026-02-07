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
import { Axis, Grid, Cell, Ref, Sref, Range, Direction, SelectionType } from './types';
import { remapIndex, moveRef } from './shifting';
import { grid2string, string2grid } from './grids';
import { DimensionIndex } from './dimensions';

/**
 * `Dimensions` represents the dimensions of the sheet.
 * This is used when the sheet is created for the first time.
 * It represents cells from A1 to ZZZ729443.
 */
const Dimensions = { rows: 1000000, columns: 182780 };

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
   * `selectionType` indicates whether whole rows/columns or individual cells are selected.
   */
  private selectionType: SelectionType = 'cell';

  /**
   * `rowDimensions` manages variable row heights.
   */
  private rowDimensions?: DimensionIndex;

  /**
   * `colDimensions` manages variable column widths.
   */
  private colDimensions?: DimensionIndex;

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
   * `setDimensions` sets the dimension indices for variable row/column sizes.
   */
  setDimensions(rowDim: DimensionIndex, colDim: DimensionIndex): void {
    this.rowDimensions = rowDim;
    this.colDimensions = colDim;
  }

  /**
   * `getRowDimensions` returns the row dimension index.
   */
  getRowDimensions(): DimensionIndex | undefined {
    return this.rowDimensions;
  }

  /**
   * `getColDimensions` returns the column dimension index.
   */
  getColDimensions(): DimensionIndex | undefined {
    return this.colDimensions;
  }

  /**
   * `setRowHeight` sets the height of a row.
   */
  setRowHeight(row: number, height: number): void {
    this.rowDimensions?.setSize(row, height);
    this.store.setDimensionSize('row', row, height);
  }

  /**
   * `setColumnWidth` sets the width of a column.
   */
  setColumnWidth(col: number, width: number): void {
    this.colDimensions?.setSize(col, width);
    this.store.setDimensionSize('column', col, width);
  }

  /**
   * `loadDimensions` loads saved dimension sizes from the store into the DimensionIndex.
   */
  async loadDimensions(): Promise<void> {
    if (this.rowDimensions) {
      this.rowDimensions.clear();
      const rowHeights = await this.store.getDimensionSizes('row');
      for (const [index, size] of rowHeights) {
        this.rowDimensions.setSize(index, size);
      }
    }
    if (this.colDimensions) {
      this.colDimensions.clear();
      const colWidths = await this.store.getDimensionSizes('column');
      for (const [index, size] of colWidths) {
        this.colDimensions.setSize(index, size);
      }
    }
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
   * `insertRows` inserts rows at the given index.
   */
  async insertRows(index: number, count: number = 1): Promise<void> {
    await this.shiftCells('row', index, count);
  }

  /**
   * `deleteRows` deletes rows at the given index.
   */
  async deleteRows(index: number, count: number = 1): Promise<void> {
    await this.shiftCells('row', index, -count);
  }

  /**
   * `insertColumns` inserts columns at the given index.
   */
  async insertColumns(index: number, count: number = 1): Promise<void> {
    await this.shiftCells('column', index, count);
  }

  /**
   * `deleteColumns` deletes columns at the given index.
   */
  async deleteColumns(index: number, count: number = 1): Promise<void> {
    await this.shiftCells('column', index, -count);
  }

  /**
   * `moveRows` moves `count` rows starting at `src` to before `dst`.
   */
  async moveRows(src: number, count: number, dst: number): Promise<void> {
    await this.moveCells('row', src, count, dst);
  }

  /**
   * `moveColumns` moves `count` columns starting at `src` to before `dst`.
   */
  async moveColumns(src: number, count: number, dst: number): Promise<void> {
    await this.moveCells('column', src, count, dst);
  }

  /**
   * `shiftCells` shifts cells along the given axis, then recalculates all formulas.
   */
  private async shiftCells(
    axis: Axis,
    index: number,
    count: number,
  ): Promise<void> {
    await this.store.shiftCells(axis, index, count);

    // Shift dimension custom sizes
    if (axis === 'row') {
      this.rowDimensions?.shift(index, count);
    } else {
      this.colDimensions?.shift(index, count);
    }

    // Adjust activeCell if it's at or beyond the insertion/deletion point
    const value = axis === 'row' ? this.activeCell.r : this.activeCell.c;
    if (count > 0 && value >= index) {
      // Insert: shift active cell forward
      if (axis === 'row') {
        this.activeCell = { r: this.activeCell.r + count, c: this.activeCell.c };
      } else {
        this.activeCell = { r: this.activeCell.r, c: this.activeCell.c + count };
      }
    } else if (count < 0) {
      const absCount = Math.abs(count);
      if (value >= index && value < index + absCount) {
        // Active cell was in deleted zone, move to index (or 1 if index < 1)
        if (axis === 'row') {
          this.activeCell = { r: Math.max(1, index), c: this.activeCell.c };
        } else {
          this.activeCell = { r: this.activeCell.r, c: Math.max(1, index) };
        }
      } else if (value >= index + absCount) {
        // Active cell is after deleted zone, shift back
        if (axis === 'row') {
          this.activeCell = {
            r: this.activeCell.r + count,
            c: this.activeCell.c,
          };
        } else {
          this.activeCell = {
            r: this.activeCell.r,
            c: this.activeCell.c + count,
          };
        }
      }
    }

    // Recalculate all formula cells
    const allSrefs = new Set<Sref>();
    const fullRange: Range = [{ r: 1, c: 1 }, { r: 1000, c: 100 }];
    const grid = await this.store.getGrid(fullRange);
    for (const [sref, cell] of grid) {
      if (cell.f) {
        allSrefs.add(sref);
      }
    }

    if (allSrefs.size > 0) {
      const dependantsMap = await this.store.buildDependantsMap(allSrefs);
      await calculate(this, dependantsMap, allSrefs);
    }
  }

  /**
   * `moveCells` moves cells along the given axis, then recalculates all formulas.
   */
  private async moveCells(
    axis: Axis,
    src: number,
    count: number,
    dst: number,
  ): Promise<void> {
    // No-op if source and destination are the same
    if (dst >= src && dst <= src + count) {
      return;
    }

    await this.store.moveCells(axis, src, count, dst);

    // Move dimension custom sizes
    if (axis === 'row') {
      this.rowDimensions?.move(src, count, dst);
    } else {
      this.colDimensions?.move(src, count, dst);
    }

    // Remap activeCell
    this.activeCell = moveRef(this.activeCell, axis, src, count, dst);

    // Remap range
    if (this.range) {
      this.range = [
        moveRef(this.range[0], axis, src, count, dst),
        moveRef(this.range[1], axis, src, count, dst),
      ];
    }

    // Recalculate all formula cells
    const allSrefs = new Set<Sref>();
    const fullRange: Range = [{ r: 1, c: 1 }, { r: 1000, c: 100 }];
    const grid = await this.store.getGrid(fullRange);
    for (const [sref, cell] of grid) {
      if (cell.f) {
        allSrefs.add(sref);
      }
    }

    if (allSrefs.size > 0) {
      const dependantsMap = await this.store.buildDependantsMap(allSrefs);
      await calculate(this, dependantsMap, allSrefs);
    }
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
   * `getSelectionType` returns the current selection type.
   */
  getSelectionType(): SelectionType {
    return this.selectionType;
  }

  /**
   * `selectRow` selects an entire row.
   */
  selectRow(row: number): void {
    this.selectionType = 'row';
    this.activeCell = { r: row, c: 1 };
    this.range = [
      { r: row, c: 1 },
      { r: row, c: this.dimension.columns },
    ];
    this.store.updateActiveCell(this.activeCell);
  }

  /**
   * `selectColumn` selects an entire column.
   */
  selectColumn(col: number): void {
    this.selectionType = 'column';
    this.activeCell = { r: 1, c: col };
    this.range = [
      { r: 1, c: col },
      { r: this.dimension.rows, c: col },
    ];
    this.store.updateActiveCell(this.activeCell);
  }

  /**
   * `selectRowRange` extends the row selection to include rows from `from` to `to`.
   */
  selectRowRange(from: number, to: number): void {
    this.selectionType = 'row';
    const minRow = Math.min(from, to);
    const maxRow = Math.max(from, to);
    this.range = [
      { r: minRow, c: 1 },
      { r: maxRow, c: this.dimension.columns },
    ];
  }

  /**
   * `selectColumnRange` extends the column selection to include columns from `from` to `to`.
   */
  selectColumnRange(from: number, to: number): void {
    this.selectionType = 'column';
    const minCol = Math.min(from, to);
    const maxCol = Math.max(from, to);
    this.range = [
      { r: 1, c: minCol },
      { r: this.dimension.rows, c: maxCol },
    ];
  }

  /**
   * `getSelectedIndices` returns the selected row/column range, or null for cell selections.
   */
  getSelectedIndices(): { axis: Axis; from: number; to: number } | null {
    if (this.selectionType === 'cell' || !this.range) {
      return null;
    }

    if (this.selectionType === 'row') {
      return { axis: 'row', from: this.range[0].r, to: this.range[1].r };
    }

    return { axis: 'column', from: this.range[0].c, to: this.range[1].c };
  }

  /**
   * `selectStart` sets the start cell of the selection.
   */
  selectStart(ref: Ref): void {
    if (!inRange(ref, this.dimensionRange)) {
      return;
    }

    this.selectionType = 'cell';
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
