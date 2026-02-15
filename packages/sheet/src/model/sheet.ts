import { Store } from '../store/store';
import { calculate } from './calculator';
import {
  cloneRange,
  inRange,
  isRangeInRange,
  isSameRef,
  toRange,
  toSref,
  toSrefs,
  parseRef,
  toBorderRanges,
  isSameRange,
  mergeRanges,
} from './coordinates';
import {
  Axis,
  Grid,
  Cell,
  CellStyle,
  Ref,
  Sref,
  Range,
  Direction,
  SelectionType,
} from './types';
import {
  remapIndex,
  moveRef,
  shiftDimensionMap,
  moveDimensionMap,
  relocateFormula,
} from './shifting';
import {
  grid2string,
  string2grid,
  html2grid,
  isSpreadsheetHtml,
} from './grids';
import { DimensionIndex } from './dimensions';
import { formatValue } from './format';

/**
 * `Dimensions` represents the dimensions of the sheet.
 * This is used when the sheet is created for the first time.
 * It represents cells from A1 to ZZZ1000000.
 */
const Dimensions = { rows: 1000000, columns: 18278 };

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
   * `frozenRows` is the number of frozen rows from the top.
   */
  private frozenRows = 0;

  /**
   * `frozenCols` is the number of frozen columns from the left.
   */
  private frozenCols = 0;

  /**
   * `colStyles` caches column-level styles.
   */
  private colStyles: Map<number, CellStyle> = new Map();

  /**
   * `rowStyles` caches row-level styles.
   */
  private rowStyles: Map<number, CellStyle> = new Map();

  /**
   * `sheetStyle` caches the sheet-level default style.
   */
  private sheetStyle: CellStyle | undefined;

  /**
   * `copyBuffer` stores the source range and grid from the last copy operation.
   * Used for internal formula-aware paste with reference relocation.
   */
  private copyBuffer?: { sourceRange: Range; grid: Grid; text: string };

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
   * `getFreezePane` returns the current freeze pane position.
   */
  getFreezePane(): { frozenRows: number; frozenCols: number } {
    return { frozenRows: this.frozenRows, frozenCols: this.frozenCols };
  }

  /**
   * `setFreezePane` sets the freeze pane position.
   */
  async setFreezePane(frozenRows: number, frozenCols: number): Promise<void> {
    this.frozenRows = frozenRows;
    this.frozenCols = frozenCols;
    await this.store.setFreezePane(frozenRows, frozenCols);
  }

  /**
   * `loadFreezePane` loads the freeze pane position from the store.
   */
  async loadFreezePane(): Promise<void> {
    const { frozenRows, frozenCols } = await this.store.getFreezePane();
    this.frozenRows = frozenRows;
    this.frozenCols = frozenCols;
  }

  /**
   * `loadStyles` loads column/row/sheet styles from the store into local caches.
   */
  async loadStyles(): Promise<void> {
    this.colStyles = await this.store.getColumnStyles();
    this.rowStyles = await this.store.getRowStyles();
    this.sheetStyle = await this.store.getSheetStyle();
  }

  /**
   * `getColStyles` returns the column-level style map for rendering.
   */
  getColStyles(): Map<number, CellStyle> {
    return this.colStyles;
  }

  /**
   * `getRowStyles` returns the row-level style map for rendering.
   */
  getRowStyles(): Map<number, CellStyle> {
    return this.rowStyles;
  }

  /**
   * `getSheetStyle` returns the sheet-level default style for rendering.
   */
  getSheetStyle(): CellStyle | undefined {
    return this.sheetStyle;
  }

  /**
   * `resolveEffectiveStyle` merges sheet → column → row → cell styles.
   * Later levels override earlier ones.
   */
  resolveEffectiveStyle(
    row: number,
    col: number,
    cellStyle?: CellStyle,
  ): CellStyle | undefined {
    const s = this.sheetStyle;
    const c = this.colStyles.get(col);
    const r = this.rowStyles.get(row);
    if (!s && !c && !r && !cellStyle) return undefined;
    return { ...s, ...c, ...r, ...cellStyle };
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
    if (!cell || !cell.v) return '';
    const effective = this.resolveEffectiveStyle(ref.r, ref.c, cell.s);
    return formatValue(cell.v, effective?.nf, effective?.dp);
  }

  /**
   * `setData` sets the data at the given row and column.
   */
  async setData(ref: Ref, value: string): Promise<void> {
    this.store.beginBatch();
    try {
      // 01. Update the cell with the new value, preserving existing style.
      const existing = await this.store.get(ref);
      const base = value.startsWith('=') ? { f: value } : { v: value };
      const cell = existing?.s ? { ...base, s: existing.s } : base;

      // If the cell is effectively empty (no value, no formula, no style), delete it.
      if (this.isEmptyCell(cell)) {
        await this.store.delete(ref);
      } else {
        await this.store.set(ref, cell);
      }

      // 02. Update the dependencies.
      const dependantsMap = await this.store.buildDependantsMap([toSref(ref)]);

      // 03. Calculate the cell and its dependencies.
      await calculate(this, dependantsMap, [toSref(ref)]);
    } finally {
      this.store.endBatch();
    }
  }

  /**
   * `removeData` removes the data (value/formula) at the given range,
   * but preserves cell styles. If a cell has no style, it is deleted entirely.
   * Uses getGrid() to iterate only over populated cells for efficiency.
   */
  async removeData(): Promise<boolean> {
    this.store.beginBatch();
    try {
      const range: Range = this.range
        ? this.range
        : [this.activeCell, this.activeCell];

      const grid = await this.store.getGrid(range);
      const removeds = new Set<Sref>();

      for (const [sref, cell] of grid) {
        const ref = parseRef(sref);
        if (cell.s && Object.keys(cell.s).length > 0) {
          // Preserve style, clear value and formula.
          await this.store.set(ref, { s: cell.s });
        } else {
          await this.store.delete(ref);
        }
        removeds.add(sref);
      }

      if (removeds.size === 0) {
        return false;
      }

      const dependantsMap = await this.store.buildDependantsMap(removeds);
      await calculate(this, dependantsMap, removeds);
      return true;
    } finally {
      this.store.endBatch();
    }
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
      this.rowStyles = shiftDimensionMap(this.rowStyles, index, count);
    } else {
      this.colDimensions?.shift(index, count);
      this.colStyles = shiftDimensionMap(this.colStyles, index, count);
    }

    // Adjust activeCell if it's at or beyond the insertion/deletion point
    const value = axis === 'row' ? this.activeCell.r : this.activeCell.c;
    if (count > 0 && value >= index) {
      // Insert: shift active cell forward
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

    // Batch the freeze pane adjustment and formula recalculation together
    this.store.beginBatch();
    try {
      // Adjust freeze pane when inserting/deleting near the freeze boundary
      const frozen = axis === 'row' ? this.frozenRows : this.frozenCols;
      if (frozen > 0) {
        if (count > 0 && index <= frozen) {
          // Insert within frozen area: expand frozen region
          const newFrozen = frozen + count;
          if (axis === 'row') {
            this.frozenRows = newFrozen;
          } else {
            this.frozenCols = newFrozen;
          }
          await this.store.setFreezePane(this.frozenRows, this.frozenCols);
        } else if (count < 0) {
          const absCount = Math.abs(count);
          // Delete within frozen area: shrink frozen region
          if (index <= frozen) {
            const deletedInFrozen = Math.min(absCount, frozen - index + 1);
            const newFrozen = Math.max(0, frozen - deletedInFrozen);
            if (axis === 'row') {
              this.frozenRows = newFrozen;
            } else {
              this.frozenCols = newFrozen;
            }
            await this.store.setFreezePane(this.frozenRows, this.frozenCols);
          }
        }
      }

      // Recalculate all formula cells
      const allSrefs = new Set<Sref>();
      const fullRange: Range = [
        { r: 1, c: 1 },
        { r: 1000, c: 100 },
      ];
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
    } finally {
      this.store.endBatch();
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
      this.rowStyles = moveDimensionMap(this.rowStyles, src, count, dst);
    } else {
      this.colDimensions?.move(src, count, dst);
      this.colStyles = moveDimensionMap(this.colStyles, src, count, dst);
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

    // Batch the formula recalculation
    this.store.beginBatch();
    try {
      // Recalculate all formula cells
      const allSrefs = new Set<Sref>();
      const fullRange: Range = [
        { r: 1, c: 1 },
        { r: 1000, c: 100 },
      ];
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
    } finally {
      this.store.endBatch();
    }
  }

  /**
   * `createGrid` fetches the grid by the given range.
   */
  async fetchGrid(range: Range): Promise<Grid> {
    return this.store.getGrid(range);
  }

  /**
   * `isEmptyCell` checks if a cell has no meaningful data.
   * A cell is empty if it has no value (or empty string), no formula, and no style.
   */
  private isEmptyCell(cell: Cell): boolean {
    const hasValue = cell.v !== undefined && cell.v !== '' && cell.v !== null;
    const hasFormula = !!cell.f;
    const hasStyle = cell.s !== undefined && Object.keys(cell.s).length > 0;
    return !hasValue && !hasFormula && !hasStyle;
  }

  /**
   * `getCopyRange` returns the source range from the last copy operation,
   * or undefined if no copy buffer exists.
   */
  public getCopyRange(): Range | undefined {
    return this.copyBuffer?.sourceRange;
  }

  /**
   * `clearCopyBuffer` clears the internal copy buffer.
   */
  public clearCopyBuffer(): void {
    this.copyBuffer = undefined;
  }

  /**
   * `copy` copies the selected range and returns the TSV text for the system clipboard.
   * Also stores the full grid (with formulas and styles) in an internal buffer
   * for formula-aware paste.
   */
  public async copy(): Promise<{ text: string }> {
    const range: Range = this.range || [this.activeCell, this.activeCell];
    const grid = await this.fetchGrid(range);
    const text = grid2string(grid);
    this.copyBuffer = { sourceRange: range, grid, text };
    return { text };
  }

  /**
   * `paste` pastes content with three-tier logic:
   * 1. Internal paste (copyBuffer matches clipboard text) — relocates formula references
   * 2. Spreadsheet HTML paste (Google Sheets / Excel) — parses HTML table with styles
   * 3. Plain TSV paste — existing behavior
   */
  public async paste(options: { text?: string; html?: string }): Promise<void> {
    const { text, html } = options;
    let grid: Grid;

    if (this.copyBuffer && text === this.copyBuffer.text) {
      // Internal paste: relocate formulas based on position delta
      grid = this.relocateGrid(
        this.copyBuffer.grid,
        this.copyBuffer.sourceRange,
        this.activeCell,
      );
    } else if (html && isSpreadsheetHtml(html)) {
      // Spreadsheet HTML paste (Google Sheets / Excel)
      grid = html2grid(html, this.activeCell);
    } else if (text) {
      // Plain TSV paste
      grid = string2grid(this.activeCell, text);
    } else {
      return;
    }

    this.store.beginBatch();
    try {
      await this.setGrid(grid);

      // Recalculate formulas after paste
      const formulaSrefs = new Set<Sref>();
      for (const [sref, cell] of grid) {
        if (cell.f) {
          formulaSrefs.add(sref);
        }
      }
      if (formulaSrefs.size > 0) {
        const dependantsMap = await this.store.buildDependantsMap(formulaSrefs);
        await calculate(this, dependantsMap, formulaSrefs);
      }
    } finally {
      this.store.endBatch();
    }

    // Select the pasted range
    this.selectPastedRange(grid);
  }

  /**
   * `selectPastedRange` computes the bounding box of a pasted grid and selects it.
   */
  private selectPastedRange(grid: Grid): void {
    if (grid.size === 0) return;

    let minR = Infinity,
      maxR = -Infinity;
    let minC = Infinity,
      maxC = -Infinity;
    for (const sref of grid.keys()) {
      const ref = parseRef(sref);
      if (ref.r < minR) minR = ref.r;
      if (ref.r > maxR) maxR = ref.r;
      if (ref.c < minC) minC = ref.c;
      if (ref.c > maxC) maxC = ref.c;
    }

    if (minR === maxR && minC === maxC) {
      // Single cell pasted — just move active cell there
      this.selectStart({ r: minR, c: minC });
    } else {
      this.selectionType = 'cell';
      this.activeCell = { r: minR, c: minC };
      this.range = [
        { r: minR, c: minC },
        { r: maxR, c: maxC },
      ];
      this.store.updateActiveCell(this.activeCell);
    }
  }

  /**
   * `relocateGrid` clones a grid with formula references adjusted by the
   * position delta between sourceRange and destRef. For formula cells,
   * recalculated values are cleared (they'll be recalculated after paste).
   */
  private relocateGrid(grid: Grid, sourceRange: Range, destRef: Ref): Grid {
    const deltaRow = destRef.r - sourceRange[0].r;
    const deltaCol = destRef.c - sourceRange[0].c;
    const newGrid: Grid = new Map();

    for (const [sref, cell] of grid) {
      const ref = parseRef(sref);
      const newRef = { r: ref.r + deltaRow, c: ref.c + deltaCol };
      const newSref = toSref(newRef);

      if (cell.f) {
        const newFormula = relocateFormula(cell.f, deltaRow, deltaCol);
        newGrid.set(newSref, { f: newFormula, s: cell.s });
      } else {
        newGrid.set(newSref, { ...cell });
      }
    }

    return newGrid;
  }

  /**
   * `hasContents` checks if the given range has contents.
   */
  async hasContents(range: Range): Promise<boolean> {
    const grid = await this.store.getGrid(range);
    return grid.size > 0;
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
   * `selectAllCells` selects the entire sheet.
   */
  selectAllCells(): void {
    this.selectionType = 'all';
    this.activeCell = { r: 1, c: 1 };
    this.range = cloneRange(this.dimensionRange);
    this.store.updateActiveCell(this.activeCell);
  }

  /**
   * `getSelectedIndices` returns the selected row/column range, or null for cell selections.
   */
  getSelectedIndices(): { axis: Axis; from: number; to: number } | null {
    if (
      this.selectionType === 'cell' ||
      this.selectionType === 'all' ||
      !this.range
    ) {
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
   * `getStyle` returns the effective style of the cell at the given ref,
   * merging sheet → column → row → cell styles.
   */
  async getStyle(ref: Ref): Promise<CellStyle | undefined> {
    const cell = await this.store.get(ref);
    return this.resolveEffectiveStyle(ref.r, ref.c, cell?.s);
  }

  /**
   * `setStyle` merges the given style into the cell at the given ref.
   * Creates the cell if it doesn't exist.
   * Keeps `false` values so they can override inherited column/row/sheet styles.
   * Removes `undefined` and empty string keys.
   */
  async setStyle(ref: Ref, style: Partial<CellStyle>): Promise<void> {
    const cell = (await this.store.get(ref)) || {};
    const merged = { ...cell.s, ...style };

    // Remove undefined and empty string keys, but keep false (needed for style overrides)
    for (const key of Object.keys(merged) as Array<keyof CellStyle>) {
      if (merged[key] === undefined || merged[key] === '') {
        delete merged[key];
      }
    }

    const newCell: Cell =
      Object.keys(merged).length > 0
        ? { ...cell, s: merged }
        : { v: cell.v, f: cell.f };
    await this.store.set(ref, newCell);
  }

  /**
   * `setRangeStyle` applies the given style to all cells in the current selection range.
   * For column/row/all selections, stores styles at the column/row/sheet level
   * instead of iterating every cell.
   */
  async setRangeStyle(style: Partial<CellStyle>): Promise<void> {
    this.store.beginBatch();
    try {
      if (this.selectionType === 'column') {
        const range = this.getRangeOrActiveCell();
        for (let c = range[0].c; c <= range[1].c; c++) {
          const existing = this.colStyles.get(c) || {};
          const merged = { ...existing, ...style };
          for (const key of Object.keys(merged) as Array<keyof CellStyle>) {
            if (!merged[key] && merged[key] !== 0) {
              delete merged[key];
            }
          }
          this.colStyles.set(c, merged);
          await this.store.setColumnStyle(c, merged);
        }
        return;
      }

      if (this.selectionType === 'row') {
        const range = this.getRangeOrActiveCell();
        for (let r = range[0].r; r <= range[1].r; r++) {
          const existing = this.rowStyles.get(r) || {};
          const merged = { ...existing, ...style };
          for (const key of Object.keys(merged) as Array<keyof CellStyle>) {
            if (!merged[key] && merged[key] !== 0) {
              delete merged[key];
            }
          }
          this.rowStyles.set(r, merged);
          await this.store.setRowStyle(r, merged);
        }
        return;
      }

      if (this.selectionType === 'all') {
        const existing = this.sheetStyle || {};
        const merged = { ...existing, ...style };
        for (const key of Object.keys(merged) as Array<keyof CellStyle>) {
          if (!merged[key] && merged[key] !== 0) {
            delete merged[key];
          }
        }
        this.sheetStyle = merged;
        await this.store.setSheetStyle(merged);
        return;
      }

      // Default: cell-level styling
      const range = this.getRangeOrActiveCell();
      for (let r = range[0].r; r <= range[1].r; r++) {
        for (let c = range[0].c; c <= range[1].c; c++) {
          await this.setStyle({ r, c }, style);
        }
      }
    } finally {
      this.store.endBatch();
    }
  }

  /**
   * `toggleRangeStyle` toggles a boolean style property based on the active cell's
   * effective style (including inherited column/row/sheet styles).
   */
  async toggleRangeStyle(prop: 'b' | 'i' | 'u' | 'st'): Promise<void> {
    const effectiveStyle = await this.getStyle(this.activeCell);
    const newValue = !effectiveStyle?.[prop];
    await this.setRangeStyle({ [prop]: newValue });
  }

  /**
   * `getActiveDecimalPlaces` returns the current decimal places of the active cell.
   * Returns 2 as default if no decimal places are set.
   */
  async getActiveDecimalPlaces(): Promise<number> {
    const style = await this.getStyle(this.activeCell);
    return style?.dp ?? 2;
  }

  /**
   * `undo` undoes the last local change and reloads cached state.
   */
  async undo(): Promise<boolean> {
    const result = await this.store.undo();
    if (result.success) {
      await this.loadDimensions();
      await this.loadStyles();
      await this.loadFreezePane();

      if (result.affectedRange) {
        const [start, end] = result.affectedRange;
        this.selectionType = 'cell';
        this.activeCell = start;
        if (start.r === end.r && start.c === end.c) {
          this.range = undefined;
        } else {
          this.range = result.affectedRange;
        }
        this.store.updateActiveCell(this.activeCell);
      }
    }
    return result.success;
  }

  /**
   * `redo` redoes the last undone change and reloads cached state.
   */
  async redo(): Promise<boolean> {
    const result = await this.store.redo();
    if (result.success) {
      await this.loadDimensions();
      await this.loadStyles();
      await this.loadFreezePane();

      if (result.affectedRange) {
        const [start, end] = result.affectedRange;
        this.selectionType = 'cell';
        this.activeCell = start;
        if (start.r === end.r && start.c === end.c) {
          this.range = undefined;
        } else {
          this.range = result.affectedRange;
        }
        this.store.updateActiveCell(this.activeCell);
      }
    }
    return result.success;
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
