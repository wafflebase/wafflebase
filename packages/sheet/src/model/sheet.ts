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
  isCrossSheetRef,
  parseCrossSheetRef,
} from './coordinates';
import {
  Axis,
  Grid,
  GridResolver,
  Cell,
  CellStyle,
  MergeSpan,
  Ref,
  Sref,
  Range,
  Direction,
  SelectionType,
} from './types';
import {
  moveRef,
  shiftDimensionMap,
  moveDimensionMap,
  relocateFormula,
} from './shifting';
import {
  isMergeSplitByMove,
  moveMergeMap,
  shiftMergeMap,
  toMergeRange,
} from './merging';
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
   * `merges` stores merged range spans keyed by anchor sref.
   */
  private merges: Map<Sref, MergeSpan> = new Map();

  /**
   * `mergeCoverMap` maps covered non-anchor srefs to their anchor sref.
   */
  private mergeCoverMap: Map<Sref, Sref> = new Map();

  /**
   * `copyBuffer` stores the source range and grid from the last copy operation.
   * Used for internal formula-aware paste with reference relocation.
   */
  private copyBuffer?: { sourceRange: Range; grid: Grid; text: string };

  /**
   * `gridResolver` resolves cell data from other sheets for cross-sheet formula references.
   */
  private gridResolver?: GridResolver;

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
   * `loadMerges` loads merged range metadata from the store into local caches.
   */
  async loadMerges(): Promise<void> {
    this.merges = await this.store.getMerges();
    this.rebuildMergeCoverMap();
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
   * `getMerges` returns merged range metadata for rendering.
   */
  getMerges(): Map<Sref, MergeSpan> {
    return this.merges;
  }

  /**
   * `rebuildMergeCoverMap` rebuilds covered-cell -> anchor lookup.
   */
  private rebuildMergeCoverMap(): void {
    this.mergeCoverMap.clear();
    for (const [anchorSref, span] of this.merges) {
      const anchor = parseRef(anchorSref);
      for (let r = anchor.r; r < anchor.r + span.rs; r++) {
        for (let c = anchor.c; c < anchor.c + span.cs; c++) {
          const sref = toSref({ r, c });
          if (sref === anchorSref) continue;
          this.mergeCoverMap.set(sref, anchorSref);
        }
      }
    }
  }

  /**
   * `getAnchorSrefForRef` returns anchor sref if ref is in a merge.
   */
  private getAnchorSrefForRef(ref: Ref): Sref {
    const sref = toSref(ref);
    if (this.merges.has(sref)) return sref;
    return this.mergeCoverMap.get(sref) || sref;
  }

  /**
   * `normalizeRefToAnchor` maps covered refs to their merge anchor ref.
   */
  private normalizeRefToAnchor(ref: Ref): Ref {
    return parseRef(this.getAnchorSrefForRef(ref));
  }

  /**
   * `getMergeForRef` returns merge metadata if `ref` is in a merged block.
   */
  private getMergeForRef(
    ref: Ref,
  ): { anchorSref: Sref; anchor: Ref; span: MergeSpan; range: Range } | undefined {
    const anchorSref = this.getAnchorSrefForRef(ref);
    const span = this.merges.get(anchorSref);
    if (!span) return undefined;
    const anchor = parseRef(anchorSref);
    return { anchorSref, anchor, span, range: toMergeRange(anchor, span) };
  }

  /**
   * `expandRangeToMergedBoundaries` expands a range to include full intersecting merges.
   */
  private expandRangeToMergedBoundaries(range: Range): Range {
    let expanded = cloneRange(range);
    let changed = true;

    while (changed) {
      changed = false;
      for (const [anchorSref, span] of this.merges) {
        const mergeRange = toMergeRange(parseRef(anchorSref), span);
        if (!inRange(mergeRange[0], expanded) && !inRange(mergeRange[1], expanded)) {
          const intersects =
            mergeRange[0].r <= expanded[1].r &&
            mergeRange[1].r >= expanded[0].r &&
            mergeRange[0].c <= expanded[1].c &&
            mergeRange[1].c >= expanded[0].c;
          if (!intersects) continue;
        }
        const next = mergeRanges(expanded, mergeRange);
        if (!isSameRange(next, expanded)) {
          expanded = next;
          changed = true;
        }
      }
    }

    return expanded;
  }

  /**
   * `mergeCoveredSrefs` yields all srefs in the given merged block (including anchor).
   */
  private *mergeCoveredSrefs(anchor: Ref, span: MergeSpan): Generator<Sref> {
    for (let r = anchor.r; r < anchor.r + span.rs; r++) {
      for (let c = anchor.c; c < anchor.c + span.cs; c++) {
        yield toSref({ r, c });
      }
    }
  }

  /**
   * `expandChangedSrefsWithMergeAliases` expands refs to include merge aliases.
   */
  private expandChangedSrefsWithMergeAliases(srefs: Iterable<Sref>): Set<Sref> {
    const changed = new Set<Sref>();
    for (const sref of srefs) {
      const anchorSref = this.getAnchorSrefForRef(parseRef(sref));
      const span = this.merges.get(anchorSref);
      if (!span) {
        changed.add(sref);
        continue;
      }
      const anchor = parseRef(anchorSref);
      for (const covered of this.mergeCoveredSrefs(anchor, span)) {
        changed.add(covered);
      }
    }
    return changed;
  }

  /**
   * `getMergesIntersecting` returns merged blocks intersecting `range`.
   */
  private getMergesIntersecting(
    range: Range,
  ): Array<{ anchorSref: Sref; anchor: Ref; span: MergeSpan; range: Range }> {
    const result: Array<{
      anchorSref: Sref;
      anchor: Ref;
      span: MergeSpan;
      range: Range;
    }> = [];
    for (const [anchorSref, span] of this.merges) {
      const anchor = parseRef(anchorSref);
      const mergeRange = toMergeRange(anchor, span);
      const intersects =
        mergeRange[0].r <= range[1].r &&
        mergeRange[1].r >= range[0].r &&
        mergeRange[0].c <= range[1].c &&
        mergeRange[1].c >= range[0].c;
      if (!intersects) continue;
      result.push({ anchorSref, anchor, span, range: mergeRange });
    }
    return result;
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
    return this.store.get(this.normalizeRefToAnchor(ref));
  }

  /**
   * `setCell` sets the cell at the given row and column.
   */
  async setCell(ref: Ref, cell: Cell): Promise<void> {
    await this.store.set(this.normalizeRefToAnchor(ref), cell);
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
    const cell = await this.getCell(ref);
    return cell && cell.f ? true : false;
  }

  /**
   * `toInputString` returns the input string at the given row and column.
   */
  async toInputString(ref: Ref): Promise<string> {
    const cell = await this.getCell(ref);
    return !cell ? '' : cell.f ? cell.f : cell.v || '';
  }

  /**
   * `toDisplayString` returns the display string at the given row and column.
   */
  async toDisplayString(ref: Ref): Promise<string> {
    const anchor = this.normalizeRefToAnchor(ref);
    const cell = await this.store.get(anchor);
    if (!cell || !cell.v) return '';
    const effective = this.resolveEffectiveStyle(anchor.r, anchor.c, cell.s);
    return formatValue(cell.v, effective?.nf, effective?.dp);
  }

  /**
   * `setData` sets the data at the given row and column.
   */
  async setData(ref: Ref, value: string): Promise<void> {
    const target = this.normalizeRefToAnchor(ref);
    this.store.beginBatch();
    try {
      // 01. Update the cell with the new value, preserving existing style.
      const existing = await this.store.get(target);
      const base = value.startsWith('=') ? { f: value } : { v: value };
      const cell = existing?.s ? { ...base, s: existing.s } : base;

      // If the cell is effectively empty (no value, no formula, no style), delete it.
      if (this.isEmptyCell(cell)) {
        await this.store.delete(target);
      } else {
        await this.store.set(target, cell);
      }

      // 02. Update the dependencies.
      const changedSrefs = this.expandChangedSrefsWithMergeAliases([
        toSref(target),
      ]);
      const dependantsMap = await this.store.buildDependantsMap(changedSrefs);

      // 03. Calculate the cell and its dependencies.
      await calculate(this, dependantsMap, changedSrefs);
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
      const range: Range = this.getRangeOrActiveCell();

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

      const changedSrefs = this.expandChangedSrefsWithMergeAliases(removeds);
      const dependantsMap = await this.store.buildDependantsMap(changedSrefs);
      await calculate(this, dependantsMap, changedSrefs);
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
    this.merges = shiftMergeMap(this.merges, axis, index, count);
    this.rebuildMergeCoverMap();

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
    this.activeCell = this.normalizeRefToAnchor(this.activeCell);

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

    for (const [anchorSref, span] of this.merges) {
      const anchor = parseRef(anchorSref);
      if (isMergeSplitByMove(anchor, span, axis, src, count)) {
        return;
      }
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
    this.merges = moveMergeMap(this.merges, axis, src, count, dst);
    this.rebuildMergeCoverMap();

    // Remap activeCell
    this.activeCell = this.normalizeRefToAnchor(
      moveRef(this.activeCell, axis, src, count, dst),
    );

    // Remap range
    if (this.range) {
      this.range = this.expandRangeToMergedBoundaries([
        moveRef(this.range[0], axis, src, count, dst),
        moveRef(this.range[1], axis, src, count, dst),
      ]);
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
    const range: Range = this.getRangeOrActiveCell();
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

      // Recalculate from all changed refs, not only pasted formulas.
      // This ensures pasting plain values triggers dependant formula chains.
      const changedSrefs = new Set<Sref>();
      for (const [sref] of grid) {
        changedSrefs.add(sref);
      }
      if (changedSrefs.size > 0) {
        const expanded = this.expandChangedSrefsWithMergeAliases(changedSrefs);
        const dependantsMap = await this.store.buildDependantsMap(expanded);
        await calculate(this, dependantsMap, expanded);
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
    const crossSheetRefs = new Map<string, Set<Sref>>();

    for (const sref of toSrefs(references)) {
      if (isCrossSheetRef(sref)) {
        // Group cross-sheet refs by sheet name
        const { sheetName, localRef } = parseCrossSheetRef(sref);
        if (!crossSheetRefs.has(sheetName.toUpperCase())) {
          crossSheetRefs.set(sheetName.toUpperCase(), new Set());
        }
        crossSheetRefs.get(sheetName.toUpperCase())!.add(localRef);
      } else {
        // Local ref
        const anchor = this.normalizeRefToAnchor(parseRef(sref));
        const cell = await this.store.get(anchor);
        if (cell) {
          grid.set(sref, cell);
        }
      }
    }

    // Resolve cross-sheet refs via gridResolver
    if (this.gridResolver && crossSheetRefs.size > 0) {
      for (const [sheetName, refs] of crossSheetRefs) {
        const resolved = this.gridResolver(sheetName, refs);
        if (resolved) {
          for (const [localRef, cell] of resolved) {
            grid.set(`${sheetName}!${localRef}`, cell);
          }
        }
      }
    }

    return grid;
  }

  /**
   * `setGridResolver` sets the resolver for cross-sheet formula references.
   */
  public setGridResolver(resolver: GridResolver): void {
    this.gridResolver = resolver;
  }

  /**
   * `recalculateCrossSheetFormulas` re-evaluates all formula cells that
   * reference other sheets by recalculating all formulas in one dependency pass.
   * Call this when another sheet's data changes so cross-sheet values refresh.
   */
  public async recalculateCrossSheetFormulas(): Promise<void> {
    const formulaGrid = await this.store.getFormulaGrid();
    const formulaSrefs = new Set<Sref>();
    for (const [sref] of formulaGrid) {
      formulaSrefs.add(sref);
    }

    if (formulaSrefs.size === 0) {
      return;
    }

    this.store.beginBatch();
    try {
      const dependantsMap = await this.store.buildDependantsMap(formulaSrefs);
      await calculate(this, dependantsMap, formulaSrefs);
    } finally {
      this.store.endBatch();
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
    const anchor = this.normalizeRefToAnchor(ref);
    this.activeCell = anchor;
    this.store.updateActiveCell(anchor);
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
    if (this.range) {
      return this.expandRangeToMergedBoundaries(this.range);
    }
    const merged = this.getMergeForRef(this.activeCell);
    return merged ? merged.range : [this.activeCell, this.activeCell];
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
    this.setActiveCell(this.normalizeRefToAnchor(ref));
    this.range = undefined;
  }

  /**
   * `selectEnd` sets the end cell of the selection.
   */
  selectEnd(ref: Ref): void {
    if (!inRange(ref, this.dimensionRange)) {
      return;
    }

    const target = this.normalizeRefToAnchor(ref);
    if (isSameRef(this.activeCell, target)) {
      this.range = undefined;
      return;
    }

    this.range = this.expandRangeToMergedBoundaries(
      toRange(this.activeCell, target),
    );
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
    const activeMerge = this.getMergeForRef(this.activeCell);
    const startRef = { ...this.activeCell };
    if (activeMerge) {
      if (direction === 'right') {
        startRef.c = activeMerge.range[1].c;
      } else if (direction === 'down') {
        startRef.r = activeMerge.range[1].r;
      }
    }

    // Move to the edge of the content.
    // If the cell is empty, move to the first non-empty cell.
    // If the cell is non-empty, move to the last non-empty cell.
    const ref = await this.store.findEdge(
      startRef,
      direction,
      this.dimensionRange,
    );
    const normalized = this.normalizeRefToAnchor(ref);

    if (isSameRef(this.activeCell, normalized)) {
      return false;
    }

    this.range = undefined;
    this.setActiveCell(normalized);
    return true;
  }

  /**
   * `move` moves the selection by the given delta.
   * @return boolean if the selection was moved.
   */
  move(direction: Direction): boolean {
    const rowDelta = direction === 'up' ? -1 : direction === 'down' ? 1 : 0;
    const colDelta = direction === 'left' ? -1 : direction === 'right' ? 1 : 0;

    let row = this.activeCell.r;
    let col = this.activeCell.c;
    const activeMerge = this.getMergeForRef(this.activeCell);
    if (activeMerge) {
      if (direction === 'right') {
        col = activeMerge.range[1].c + 1;
      } else if (direction === 'down') {
        row = activeMerge.range[1].r + 1;
      } else if (direction === 'left') {
        col -= 1;
      } else {
        row -= 1;
      }
    } else {
      row += rowDelta;
      col += colDelta;
    }

    if (!inRange({ r: row, c: col }, this.dimensionRange)) {
      return false;
    }

    const target = this.normalizeRefToAnchor({ r: row, c: col });
    if (isSameRef(this.activeCell, target)) {
      return false;
    }

    this.range = undefined;
    this.setActiveCell(target);
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
    let range = cloneRange(this.getRangeOrActiveCell());

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

    this.range = this.expandRangeToMergedBoundaries(range);
    return true;
  }

  /**
   * `getStyle` returns the effective style of the cell at the given ref,
   * merging sheet → column → row → cell styles.
   */
  async getStyle(ref: Ref): Promise<CellStyle | undefined> {
    const anchor = this.normalizeRefToAnchor(ref);
    const cell = await this.store.get(anchor);
    return this.resolveEffectiveStyle(anchor.r, anchor.c, cell?.s);
  }

  /**
   * `setStyle` merges the given style into the cell at the given ref.
   * Creates the cell if it doesn't exist.
   * Keeps `false` values so they can override inherited column/row/sheet styles.
   * Removes `undefined` and empty string keys.
   */
  async setStyle(ref: Ref, style: Partial<CellStyle>): Promise<void> {
    const anchor = this.normalizeRefToAnchor(ref);
    const cell = (await this.store.get(anchor)) || {};
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
    await this.store.set(anchor, newCell);
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
   * `isSelectionMerged` returns true when current cell selection matches one merged block.
   */
  isSelectionMerged(): boolean {
    if (this.selectionType !== 'cell') return false;
    const selection = this.getRangeOrActiveCell();
    const merges = this.getMergesIntersecting(selection);
    return merges.length === 1 && isSameRange(merges[0].range, selection);
  }

  /**
   * `canMergeSelection` returns whether current selection can be merged.
   */
  canMergeSelection(): boolean {
    if (this.selectionType !== 'cell') return false;
    const selection = this.getRangeOrActiveCell();
    const isCollapsed =
      selection[0].r === selection[1].r && selection[0].c === selection[1].c;
    if (isCollapsed) return false;
    const crossesFrozenRows =
      this.frozenRows > 0 &&
      selection[0].r <= this.frozenRows &&
      selection[1].r > this.frozenRows;
    const crossesFrozenCols =
      this.frozenCols > 0 &&
      selection[0].c <= this.frozenCols &&
      selection[1].c > this.frozenCols;
    if (crossesFrozenRows || crossesFrozenCols) return false;
    return this.getMergesIntersecting(selection).length === 0;
  }

  /**
   * `toggleMergeSelection` merges/unmerges current selection.
   */
  async toggleMergeSelection(): Promise<boolean> {
    if (this.isSelectionMerged()) {
      return this.unmergeSelection();
    }
    return this.mergeSelection();
  }

  /**
   * `mergeSelection` merges the current cell selection.
   */
  async mergeSelection(): Promise<boolean> {
    if (!this.canMergeSelection()) return false;

    const range = this.getRangeOrActiveCell();
    const anchor = range[0];
    const span: MergeSpan = {
      rs: range[1].r - range[0].r + 1,
      cs: range[1].c - range[0].c + 1,
    };
    const changedSrefs = new Set<Sref>();
    for (const sref of this.mergeCoveredSrefs(anchor, span)) {
      changedSrefs.add(sref);
    }

    this.store.beginBatch();
    try {
      for (let r = range[0].r; r <= range[1].r; r++) {
        for (let c = range[0].c; c <= range[1].c; c++) {
          if (r === anchor.r && c === anchor.c) continue;
          const ref = { r, c };
          const cell = await this.store.get(ref);
          if (!cell) continue;
          if (cell.s && Object.keys(cell.s).length > 0) {
            await this.store.set(ref, { s: cell.s });
          } else {
            await this.store.delete(ref);
          }
        }
      }

      await this.store.setMerge(anchor, span);
      this.merges.set(toSref(anchor), span);
      this.rebuildMergeCoverMap();

      const expanded = this.expandChangedSrefsWithMergeAliases(changedSrefs);
      const dependantsMap = await this.store.buildDependantsMap(expanded);
      await calculate(this, dependantsMap, expanded);
    } finally {
      this.store.endBatch();
    }

    this.selectionType = 'cell';
    this.setActiveCell(anchor);
    this.range = toMergeRange(anchor, span);
    return true;
  }

  /**
   * `unmergeSelection` removes merged blocks intersecting current selection.
   */
  async unmergeSelection(): Promise<boolean> {
    if (this.selectionType !== 'cell') return false;

    const selection = this.getRangeOrActiveCell();
    const merges = this.getMergesIntersecting(selection);
    if (merges.length === 0) return false;

    const changedSrefs = new Set<Sref>();
    for (const merge of merges) {
      for (const sref of this.mergeCoveredSrefs(merge.anchor, merge.span)) {
        changedSrefs.add(sref);
      }
    }

    this.store.beginBatch();
    try {
      for (const merge of merges) {
        await this.store.deleteMerge(merge.anchor);
        this.merges.delete(merge.anchorSref);
      }
      this.rebuildMergeCoverMap();

      const expanded = this.expandChangedSrefsWithMergeAliases(changedSrefs);
      const dependantsMap = await this.store.buildDependantsMap(expanded);
      await calculate(this, dependantsMap, expanded);
    } finally {
      this.store.endBatch();
    }

    this.selectionType = 'cell';
    this.range = undefined;
    return true;
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
      await this.loadMerges();
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
      await this.loadMerges();
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
    const activeMerge = this.getMergeForRef(this.activeCell);
    const rows = range[1].r - range[0].r + 1;
    const cols = range[1].c - range[0].c + 1;
    if (rowDelta !== 0) {
      const step =
        rowDelta > 0
          ? activeMerge
            ? activeMerge.span.rs
            : rowDelta
          : rowDelta < 0
            ? -1
            : 0;
      if (row + step > range[1].r) {
        row = range[0].r;
        col = ((col + 1 - range[0].c + cols) % cols) + range[0].c;
      } else if (row + step < range[0].r) {
        row = range[1].r;
        col = ((col - 1 - range[0].c + cols) % cols) + range[0].c;
      } else {
        row += step;
      }
    }

    if (colDelta !== 0) {
      const step =
        colDelta > 0
          ? activeMerge
            ? activeMerge.span.cs
            : colDelta
          : colDelta < 0
            ? -1
            : 0;
      if (col + step > range[1].c) {
        col = range[0].c;
        row = ((row + 1 - range[0].r + rows) % rows) + range[0].r;
      } else if (col + step < range[0].c) {
        col = range[1].c;
        row = ((row - 1 - range[0].r + rows) % rows) + range[0].r;
      } else {
        col += step;
      }
    }

    this.setActiveCell(this.normalizeRefToAnchor({ r: row, c: col }));
  }
}
