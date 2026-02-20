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
  BorderPreset,
  Grid,
  GridResolver,
  Cell,
  CellStyle,
  ConditionalFormatRule,
  FilterCondition,
  FilterState,
  MergeSpan,
  Ref,
  Sref,
  Range,
  Direction,
  SelectionType,
} from './types';
import {
  moveRef,
  remapIndex,
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
import { inferInput, type InferredInput } from './input';
import {
  cloneConditionalFormatRule,
  moveConditionalFormatRules,
  normalizeConditionalFormatRule,
  shiftConditionalFormatRules,
} from './conditional-format';
import {
  RangeStylePatch,
  clipRangeStylePatches,
  mergeStylePatch,
  moveRangeStylePatches,
  normalizeRangeStylePatch,
  normalizeStylePatch,
  pruneShadowedRangeStylePatches,
  resolveRangeStyleAt,
  shiftRangeStylePatches,
  stylesEqual,
  translateRangeStylePatches,
} from './range-styles';

/**
 * `Dimensions` represents the dimensions of the sheet.
 * This is used when the sheet is created for the first time.
 * It represents cells from A1 to ZZZ1000000.
 */
const Dimensions = { rows: 1000000, columns: 18278 };
const MaxBorderSelectionCells = 50000;
const DefaultStyleValues: Partial<CellStyle> = {
  b: false,
  i: false,
  u: false,
  st: false,
  bt: false,
  br: false,
  bb: false,
  bl: false,
  al: 'left',
  va: 'top',
  nf: 'plain',
  dp: 2,
};

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
   * `rangeStyles` stores range-level style patches in apply order.
   */
  private rangeStyles: RangeStylePatch[] = [];

  /**
   * `conditionalFormats` stores conditional formatting rules in apply order.
   */
  private conditionalFormats: ConditionalFormatRule[] = [];

  /**
   * `merges` stores merged range spans keyed by anchor sref.
   */
  private merges: Map<Sref, MergeSpan> = new Map();

  /**
   * `mergeCoverMap` maps covered non-anchor srefs to their anchor sref.
   */
  private mergeCoverMap: Map<Sref, Sref> = new Map();

  /**
   * `filterRange` represents the filtered table range (header row included).
   */
  private filterRange?: Range;

  /**
   * `filterColumns` stores column-specific criteria keyed by absolute column index.
   */
  private filterColumns: Map<number, FilterCondition> = new Map();

  /**
   * `hiddenRows` stores row indices hidden by the active filter.
   */
  private hiddenRows: Set<number> = new Set();

  /**
   * `copyBuffer` stores the source range and grid from the last copy operation.
   * Used for internal formula-aware paste with reference relocation.
   */
  private copyBuffer?: {
    sourceRange: Range;
    grid: Grid;
    rangeStyles: RangeStylePatch[];
    text: string;
  };

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
    this.rangeStyles = await this.store.getRangeStyles();
    this.conditionalFormats = await this.store.getConditionalFormats();
  }

  /**
   * `loadMerges` loads merged range metadata from the store into local caches.
   */
  async loadMerges(): Promise<void> {
    this.merges = await this.store.getMerges();
    this.rebuildMergeCoverMap();
  }

  /**
   * `loadFilterState` loads filter metadata from the store.
   */
  async loadFilterState(): Promise<void> {
    const state = await this.store.getFilterState();
    if (!state) {
      this.filterRange = undefined;
      this.filterColumns.clear();
      this.hiddenRows.clear();
      return;
    }

    this.filterRange = toRange(state.range[0], state.range[1]);
    this.filterColumns = new Map();
    for (const [key, condition] of Object.entries(state.columns)) {
      const col = Number(key);
      if (!Number.isFinite(col)) continue;
      this.filterColumns.set(col, { ...condition });
    }
    this.normalizeFilterColumnsToRange();
    this.hiddenRows = new Set(state.hiddenRows.filter((row) => row > 0));
    this.pruneHiddenRowsOutsideFilter();
    this.ensureActiveCellVisibleAfterFiltering();
  }

  /**
   * `hasFilter` returns whether a filter range is active.
   */
  hasFilter(): boolean {
    return !!this.filterRange;
  }

  /**
   * `getFilterRange` returns the active filter range.
   */
  getFilterRange(): Range | undefined {
    return this.filterRange ? cloneRange(this.filterRange) : undefined;
  }

  /**
   * `getHiddenRows` returns currently hidden row indices due to filtering.
   */
  getHiddenRows(): Set<number> {
    return new Set(this.hiddenRows);
  }

  /**
   * `getFilteredColumns` returns columns that currently have filter criteria.
   */
  getFilteredColumns(): Set<number> {
    return new Set(this.filterColumns.keys());
  }

  /**
   * `getColumnFilterCondition` returns the current condition for `col`.
   */
  getColumnFilterCondition(col: number): FilterCondition | undefined {
    const condition = this.filterColumns.get(col);
    if (!condition) return undefined;
    return {
      ...condition,
      values: condition.values ? [...condition.values] : undefined,
    };
  }

  /**
   * `isColumnInFilter` returns whether `col` is inside the active filter range.
   */
  isColumnInFilter(col: number): boolean {
    if (!this.filterRange) return false;
    return col >= this.filterRange[0].c && col <= this.filterRange[1].c;
  }

  /**
   * `getFilterState` returns the current persisted filter state payload.
   */
  getFilterState(): FilterState | undefined {
    return this.buildFilterStatePayload();
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
   * `getRangeStyles` returns the range-level style patches for rendering.
   */
  getRangeStyles(): RangeStylePatch[] {
    return this.rangeStyles.map((patch) => ({
      range: cloneRange(patch.range),
      style: { ...patch.style },
    }));
  }

  /**
   * `getConditionalFormats` returns conditional formatting rules in apply order.
   */
  getConditionalFormats(): ConditionalFormatRule[] {
    return this.conditionalFormats.map((rule) =>
      cloneConditionalFormatRule(rule),
    );
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
   * `resolveEffectiveStyle` merges sheet → column → row → range → cell styles.
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
    const range = resolveRangeStyleAt(this.rangeStyles, row, col);
    if (!s && !c && !r && !range && !cellStyle) return undefined;
    return { ...s, ...c, ...r, ...range, ...cellStyle };
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
    return formatValue(cell.v, effective?.nf, effective?.dp, {
      currency: effective?.cu,
    });
  }

  /**
   * `toStoredValue` converts inferred non-formula input to normalized storage value.
   */
  private toStoredValue(inferred: Exclude<InferredInput, { type: 'formula' }>): string {
    switch (inferred.type) {
      case 'number':
        return inferred.value.toString();
      case 'date':
      case 'text':
        return inferred.value;
      case 'boolean':
        return inferred.value ? 'TRUE' : 'FALSE';
    }
  }

  /**
   * `applyInferredFormat` applies inferred format metadata onto an existing style.
   */
  private applyInferredFormat(
    existing: CellStyle | undefined,
    inferred: InferredInput,
  ): CellStyle | undefined {
    if (inferred.type === 'date') {
      const style: CellStyle = { ...(existing || {}), nf: 'date' };
      delete style.cu;
      return style;
    }

    if (inferred.type === 'number' && inferred.format === 'percent') {
      const style: CellStyle = { ...(existing || {}), nf: 'percent' };
      delete style.cu;
      return style;
    }

    if (
      inferred.type === 'number' &&
      inferred.format?.startsWith('currency:')
    ) {
      const style: CellStyle = {
        ...(existing || {}),
        nf: 'currency',
        cu: inferred.format.slice('currency:'.length),
      };
      return style;
    }

    return existing ? { ...existing } : undefined;
  }

  /**
   * `applyInputInferenceToGrid` normalizes pasted external cell input values.
   */
  private applyInputInferenceToGrid(grid: Grid): Grid {
    const normalized: Grid = new Map();
    for (const [sref, cell] of grid) {
      if (cell.f) {
        normalized.set(sref, { ...cell });
        continue;
      }

      const inferred = inferInput(cell.v ?? '');
      const style = this.applyInferredFormat(cell.s, inferred);
      const base =
        inferred.type === 'formula'
          ? { f: `=${inferred.value}` }
          : { v: this.toStoredValue(inferred) };
      normalized.set(sref, this.compactCell(base, style));
    }
    return normalized;
  }

  /**
   * `setData` sets the data at the given row and column.
   */
  async setData(ref: Ref, value: string): Promise<void> {
    const target = this.normalizeRefToAnchor(ref);
    this.store.beginBatch();
    try {
      // 01. Update the cell with normalized inferred value and style metadata.
      const existing = await this.store.get(target);
      const inferred = inferInput(value);
      const style = this.applyInferredFormat(existing?.s, inferred);
      const base =
        inferred.type === 'formula'
          ? { f: `=${inferred.value}` }
          : { v: this.toStoredValue(inferred) };
      const cell = this.compactCell(base, style);

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

      // 04. Recompute active filter visibility if needed.
      if (this.filterRange) {
        await this.recomputeFilterHiddenRows();
      }
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

      if (this.filterRange) {
        await this.recomputeFilterHiddenRows();
      }
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
    this.rangeStyles = shiftRangeStylePatches(
      this.rangeStyles,
      axis,
      index,
      count,
    );
    this.conditionalFormats = shiftConditionalFormatRules(
      this.conditionalFormats,
      axis,
      index,
      count,
    );
    this.merges = shiftMergeMap(this.merges, axis, index, count);
    this.rebuildMergeCoverMap();
    this.shiftFilterState(axis, index, count);

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

      await this.recalculateAllFormulaCells();

      if (this.filterRange) {
        await this.recomputeFilterHiddenRows();
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
    options?: { skipPostRecalculate?: boolean },
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
    this.rangeStyles = moveRangeStylePatches(
      this.rangeStyles,
      axis,
      src,
      count,
      dst,
    );
    this.conditionalFormats = moveConditionalFormatRules(
      this.conditionalFormats,
      axis,
      src,
      count,
      dst,
    );
    this.merges = moveMergeMap(this.merges, axis, src, count, dst);
    this.rebuildMergeCoverMap();
    this.moveFilterState(axis, src, count, dst);

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

    if (options?.skipPostRecalculate) {
      return;
    }

    // Batch the formula recalculation
    this.store.beginBatch();
    try {
      await this.recalculateAllFormulaCells();
      if (this.filterRange) {
        await this.recomputeFilterHiddenRows();
      }
    } finally {
      this.store.endBatch();
    }
  }

  /**
   * `recalculateAllFormulaCells` recalculates all formula cells in the worksheet.
   */
  private async recalculateAllFormulaCells(): Promise<void> {
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
  }

  /**
   * `buildFilterStatePayload` serializes in-memory filter state for persistence.
   */
  private buildFilterStatePayload(): FilterState | undefined {
    if (!this.filterRange) return undefined;

    const columns: Record<string, FilterCondition> = {};
    const sortedColumns = Array.from(this.filterColumns.entries()).sort(
      (a, b) => a[0] - b[0],
    );
    for (const [col, condition] of sortedColumns) {
      if (!this.isColumnInFilter(col)) continue;
      columns[String(col)] = { ...condition };
    }

    return {
      range: cloneRange(this.filterRange),
      columns,
      hiddenRows: Array.from(this.hiddenRows).sort((a, b) => a - b),
    };
  }

  /**
   * `normalizeFilterColumnsToRange` removes criteria outside the active filter range.
   */
  private normalizeFilterColumnsToRange(): void {
    if (!this.filterRange) {
      this.filterColumns.clear();
      return;
    }

    for (const col of this.filterColumns.keys()) {
      if (!this.isColumnInFilter(col)) {
        this.filterColumns.delete(col);
      }
    }
  }

  /**
   * `pruneHiddenRowsOutsideFilter` keeps hidden rows within filter data rows only.
   */
  private pruneHiddenRowsOutsideFilter(): void {
    if (!this.filterRange) {
      this.hiddenRows.clear();
      return;
    }

    const dataStart = this.filterRange[0].r + 1;
    const dataEnd = this.filterRange[1].r;
    const next = new Set<number>();
    for (const row of this.hiddenRows) {
      if (row >= dataStart && row <= dataEnd) {
        next.add(row);
      }
    }
    this.hiddenRows = next;
  }

  /**
   * `normalizeFilterText` converts runtime cell/filter values into plain strings.
   * Yorkie may expose wrapped primitive objects at runtime.
   */
  private normalizeFilterText(value: unknown): string {
    if (typeof value === 'string') {
      return value;
    }
    if (value === null || value === undefined) {
      return '';
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
      return String(value);
    }
    if (typeof value === 'object') {
      const withValue = value as { value?: unknown; toJSON?: () => unknown };
      if (withValue.value !== undefined && withValue.value !== value) {
        return this.normalizeFilterText(withValue.value);
      }
      if (typeof withValue.toJSON === 'function') {
        try {
          const jsonValue = withValue.toJSON.call(value);
          if (jsonValue !== value) {
            return this.normalizeFilterText(jsonValue);
          }
        } catch {
          // Ignore and fall back to string conversion.
        }
      }
    }
    return String(value);
  }

  /**
   * `normalizeFilterCondition` normalizes and validates a filter condition.
   */
  private normalizeFilterCondition(
    condition: FilterCondition,
  ): FilterCondition | undefined {
    const op = condition.op;
    if (op === 'in') {
      const values = Array.from(
        new Set(
          (condition.values || []).map((value) =>
            this.normalizeFilterText(value).trim(),
          ),
        ),
      );
      return { op, values };
    }

    if (op === 'isEmpty' || op === 'isNotEmpty') {
      return { op };
    }

    const value = this.normalizeFilterText(condition.value).trim();
    if (value.length === 0) {
      return undefined;
    }
    return { op, value };
  }

  /**
   * `matchesFilterCondition` checks whether a cell text satisfies a condition.
   */
  private matchesFilterCondition(
    value: string,
    condition: FilterCondition,
  ): boolean {
    const normalizedText = this.normalizeFilterText(value).trim();
    const normalizedValue = normalizedText.toLowerCase();
    const conditionValue = this.normalizeFilterText(condition.value)
      .trim()
      .toLowerCase();

    switch (condition.op) {
      case 'in':
        return new Set(
          (condition.values || []).map((item) =>
            this.normalizeFilterText(item).trim(),
          ),
        ).has(normalizedText);
      case 'contains':
        return normalizedValue.includes(conditionValue);
      case 'notContains':
        return !normalizedValue.includes(conditionValue);
      case 'equals':
        return normalizedValue === conditionValue;
      case 'notEquals':
        return normalizedValue !== conditionValue;
      case 'isEmpty':
        return normalizedValue.length === 0;
      case 'isNotEmpty':
        return normalizedValue.length > 0;
      default:
        return true;
    }
  }

  /**
   * `rowMatchesFilters` evaluates all column criteria for a row.
   * `excludedCol` is ignored (used for filter dropdown option derivation).
   */
  private async rowMatchesFilters(
    row: number,
    excludedCol?: number,
  ): Promise<boolean> {
    for (const [col, condition] of this.filterColumns) {
      if (col === excludedCol) continue;
      const cell = await this.getCell({ r: row, c: col });
      const value = this.normalizeFilterText(
        (cell as { v?: unknown } | undefined)?.v,
      );
      if (!this.matchesFilterCondition(value, condition)) {
        return false;
      }
    }
    return true;
  }

  /**
   * `recomputeFilterHiddenRows` recalculates hidden rows for the active filter.
   */
  private async recomputeFilterHiddenRows(): Promise<void> {
    if (!this.filterRange) {
      this.hiddenRows.clear();
      await this.store.setFilterState(undefined);
      return;
    }

    // Keep range bounded to valid dimensions.
    this.filterRange = toRange(
      {
        r: Math.max(1, this.filterRange[0].r),
        c: Math.max(1, this.filterRange[0].c),
      },
      {
        r: Math.min(this.dimension.rows, this.filterRange[1].r),
        c: Math.min(this.dimension.columns, this.filterRange[1].c),
      },
    );

    // Require at least one data row.
    if (this.filterRange[1].r <= this.filterRange[0].r) {
      this.filterRange = undefined;
      this.filterColumns.clear();
      this.hiddenRows.clear();
      await this.store.setFilterState(undefined);
      return;
    }

    this.normalizeFilterColumnsToRange();
    const nextHidden = new Set<number>();
    const dataStart = this.filterRange[0].r + 1;
    const dataEnd = this.filterRange[1].r;

    if (this.filterColumns.size > 0) {
      for (let row = dataStart; row <= dataEnd; row++) {
        if (!(await this.rowMatchesFilters(row))) {
          nextHidden.add(row);
        }
      }
    }

    this.hiddenRows = nextHidden;
    this.ensureActiveCellVisibleAfterFiltering();
    await this.store.setFilterState(this.buildFilterStatePayload());
  }

  /**
   * `shiftFilterBoundary` remaps an index after insertion/deletion.
   */
  private shiftFilterBoundary(indexValue: number, index: number, count: number): number {
    if (count > 0) {
      return indexValue >= index ? indexValue + count : indexValue;
    }

    const absCount = Math.abs(count);
    if (indexValue >= index && indexValue < index + absCount) {
      return index;
    }
    if (indexValue >= index + absCount) {
      return indexValue + count;
    }
    return indexValue;
  }

  /**
   * `shiftFilterState` remaps filter metadata for insert/delete operations.
   */
  private shiftFilterState(axis: Axis, index: number, count: number): void {
    if (!this.filterRange) {
      return;
    }

    if (axis === 'row') {
      const startRow = this.shiftFilterBoundary(this.filterRange[0].r, index, count);
      const endRow = this.shiftFilterBoundary(this.filterRange[1].r, index, count);
      this.filterRange = toRange(
        { r: Math.max(1, startRow), c: this.filterRange[0].c },
        { r: Math.max(1, endRow), c: this.filterRange[1].c },
      );

      const hiddenMap = new Map<number, number>();
      for (const row of this.hiddenRows) {
        hiddenMap.set(row, 1);
      }
      const shifted = shiftDimensionMap(hiddenMap, index, count);
      this.hiddenRows = new Set(shifted.keys());
      this.pruneHiddenRowsOutsideFilter();
      return;
    }

    const startCol = this.shiftFilterBoundary(this.filterRange[0].c, index, count);
    const endCol = this.shiftFilterBoundary(this.filterRange[1].c, index, count);
    this.filterRange = toRange(
      { r: this.filterRange[0].r, c: Math.max(1, startCol) },
      { r: this.filterRange[1].r, c: Math.max(1, endCol) },
    );

    const columnMap = new Map<number, FilterCondition>();
    for (const [col, condition] of this.filterColumns) {
      columnMap.set(col, condition);
    }
    this.filterColumns = shiftDimensionMap(columnMap, index, count);
    this.normalizeFilterColumnsToRange();
  }

  /**
   * `moveFilterState` remaps filter metadata for move operations.
   */
  private moveFilterState(axis: Axis, src: number, count: number, dst: number): void {
    if (!this.filterRange) {
      return;
    }

    if (axis === 'row') {
      const startRow = remapIndex(this.filterRange[0].r, src, count, dst);
      const endRow = remapIndex(this.filterRange[1].r, src, count, dst);
      this.filterRange = toRange(
        { r: startRow, c: this.filterRange[0].c },
        { r: endRow, c: this.filterRange[1].c },
      );

      const hiddenMap = new Map<number, number>();
      for (const row of this.hiddenRows) {
        hiddenMap.set(row, 1);
      }
      const moved = moveDimensionMap(hiddenMap, src, count, dst);
      this.hiddenRows = new Set(moved.keys());
      this.pruneHiddenRowsOutsideFilter();
      return;
    }

    const startCol = remapIndex(this.filterRange[0].c, src, count, dst);
    const endCol = remapIndex(this.filterRange[1].c, src, count, dst);
    this.filterRange = toRange(
      { r: this.filterRange[0].r, c: startCol },
      { r: this.filterRange[1].r, c: endCol },
    );

    const columnMap = new Map<number, FilterCondition>();
    for (const [col, condition] of this.filterColumns) {
      columnMap.set(col, condition);
    }
    this.filterColumns = moveDimensionMap(columnMap, src, count, dst);
    this.normalizeFilterColumnsToRange();
  }

  /**
   * `ensureActiveCellVisibleAfterFiltering` moves active cell off hidden rows.
   */
  private ensureActiveCellVisibleAfterFiltering(): void {
    if (!this.hiddenRows.has(this.activeCell.r)) {
      return;
    }

    let targetRow: number | undefined;
    if (
      this.filterRange &&
      this.activeCell.r > this.filterRange[0].r &&
      this.activeCell.r <= this.filterRange[1].r
    ) {
      targetRow = this.filterRange[0].r;
    } else {
      for (let r = this.activeCell.r + 1; r <= this.dimension.rows; r++) {
        if (!this.hiddenRows.has(r)) {
          targetRow = r;
          break;
        }
      }
      if (targetRow === undefined) {
        for (let r = this.activeCell.r - 1; r >= 1; r--) {
          if (!this.hiddenRows.has(r)) {
            targetRow = r;
            break;
          }
        }
      }
    }

    if (targetRow === undefined) {
      return;
    }

    this.range = undefined;
    this.setActiveCell({ r: targetRow, c: this.activeCell.c });
  }

  /**
   * `findNextVisibleRow` returns the next non-hidden row from `row` in `direction`.
   */
  private findNextVisibleRow(
    row: number,
    direction: 'up' | 'down',
  ): number | undefined {
    const delta = direction === 'down' ? 1 : -1;
    let current = row;
    while (current >= 1 && current <= this.dimension.rows) {
      if (!this.hiddenRows.has(current)) {
        return current;
      }
      current += delta;
    }
    return undefined;
  }

  /**
   * `createGrid` fetches the grid by the given range.
   */
  async fetchGrid(range: Range): Promise<Grid> {
    return this.store.getGrid(range);
  }

  /**
   * `hasCellContent` checks whether a cell has value or formula content.
   * Style-only cells return false.
   */
  private hasCellContent(cell: Cell): boolean {
    const hasValue = cell.v !== undefined && cell.v !== '' && cell.v !== null;
    const hasFormula = !!cell.f;
    return hasValue || hasFormula;
  }

  /**
   * `isEmptyCell` checks if a cell has no meaningful data.
   * A cell is empty if it has no value (or empty string), no formula, and no style.
   */
  private isEmptyCell(cell: Cell): boolean {
    const hasContent = this.hasCellContent(cell);
    const hasStyle = cell.s !== undefined && Object.keys(cell.s).length > 0;
    return !hasContent && !hasStyle;
  }

  private normalizeStylePatch(
    style: Partial<CellStyle>,
  ): CellStyle | undefined {
    return normalizeStylePatch(style);
  }

  private mergeStylePatch(
    base: CellStyle | undefined,
    patch: Partial<CellStyle>,
  ): CellStyle | undefined {
    return mergeStylePatch(base, patch);
  }

  private rangesIntersect(a: Range, b: Range): boolean {
    return (
      a[0].r <= b[1].r &&
      a[1].r >= b[0].r &&
      a[0].c <= b[1].c &&
      a[1].c >= b[0].c
    );
  }

  private hasConflictingStyleSourceForKey(
    range: Range,
    key: keyof CellStyle,
    targetValue: CellStyle[keyof CellStyle],
    excludedRangeStyleIndex?: number,
  ): boolean {
    const sheetValue = this.sheetStyle?.[key];
    if (sheetValue !== undefined && sheetValue !== targetValue) {
      return true;
    }

    for (const [col, style] of this.colStyles) {
      if (col < range[0].c || col > range[1].c) {
        continue;
      }
      const value = style[key];
      if (value !== undefined && value !== targetValue) {
        return true;
      }
    }

    for (const [row, style] of this.rowStyles) {
      if (row < range[0].r || row > range[1].r) {
        continue;
      }
      const value = style[key];
      if (value !== undefined && value !== targetValue) {
        return true;
      }
    }

    for (let i = 0; i < this.rangeStyles.length; i++) {
      if (excludedRangeStyleIndex !== undefined && i === excludedRangeStyleIndex) {
        continue;
      }
      const patch = this.rangeStyles[i];
      const value = patch.style[key];
      if (value === undefined || value === targetValue) {
        continue;
      }
      if (!this.rangesIntersect(range, patch.range)) {
        continue;
      }
      return true;
    }

    return false;
  }

  private pruneRedundantDefaultStyleKeys(
    range: Range,
    style: CellStyle,
    excludedRangeStyleIndex?: number,
  ): CellStyle | undefined {
    const pruned: Partial<
      Record<keyof CellStyle, CellStyle[keyof CellStyle]>
    > = {};

    for (const key of Object.keys(style) as Array<keyof CellStyle>) {
      const value = style[key];
      if (value === undefined) {
        continue;
      }

      const defaultValue = DefaultStyleValues[key];
      if (
        defaultValue !== undefined &&
        value === defaultValue &&
        !this.hasConflictingStyleSourceForKey(
          range,
          key,
          value,
          excludedRangeStyleIndex,
        )
      ) {
        continue;
      }

      pruned[key] = value as CellStyle[keyof CellStyle];
    }

    return Object.keys(pruned).length > 0
      ? (pruned as CellStyle)
      : undefined;
  }

  private sameRangeStylePatchList(
    a: RangeStylePatch[],
    b: RangeStylePatch[],
  ): boolean {
    if (a.length !== b.length) {
      return false;
    }
    for (let i = 0; i < a.length; i++) {
      if (!isSameRange(a[i].range, b[i].range)) {
        return false;
      }
      if (!stylesEqual(a[i].style, b[i].style)) {
        return false;
      }
    }
    return true;
  }

  private compactShadowedRangeStyles(): boolean {
    const compacted = pruneShadowedRangeStylePatches(this.rangeStyles);
    if (this.sameRangeStylePatchList(compacted, this.rangeStyles)) {
      return false;
    }
    this.rangeStyles = compacted;
    return true;
  }

  private containsRange(outer: Range, inner: Range): boolean {
    return (
      outer[0].r <= inner[0].r &&
      outer[0].c <= inner[0].c &&
      outer[1].r >= inner[1].r &&
      outer[1].c >= inner[1].c
    );
  }

  private mergeableColBand(a: Range, b: Range): boolean {
    if (a[0].r !== b[0].r || a[1].r !== b[1].r) return false;
    return b[0].c <= a[1].c + 1 && a[0].c <= b[1].c + 1;
  }

  private mergeableRowBand(a: Range, b: Range): boolean {
    if (a[0].c !== b[0].c || a[1].c !== b[1].c) return false;
    return b[0].r <= a[1].r + 1 && a[0].r <= b[1].r + 1;
  }

  private tryMergeRangeStylePatches(
    prev: RangeStylePatch,
    next: RangeStylePatch,
  ): RangeStylePatch | undefined {
    if (!stylesEqual(prev.style, next.style)) {
      return undefined;
    }

    if (isSameRange(prev.range, next.range) || this.containsRange(prev.range, next.range)) {
      return prev;
    }

    if (this.containsRange(next.range, prev.range)) {
      return next;
    }

    if (this.mergeableColBand(prev.range, next.range)) {
      return {
        range: [
          {
            r: prev.range[0].r,
            c: Math.min(prev.range[0].c, next.range[0].c),
          },
          {
            r: prev.range[1].r,
            c: Math.max(prev.range[1].c, next.range[1].c),
          },
        ],
        style: { ...prev.style },
      };
    }

    if (this.mergeableRowBand(prev.range, next.range)) {
      return {
        range: [
          {
            r: Math.min(prev.range[0].r, next.range[0].r),
            c: prev.range[0].c,
          },
          {
            r: Math.max(prev.range[1].r, next.range[1].r),
            c: prev.range[1].c,
          },
        ],
        style: { ...prev.style },
      };
    }

    return undefined;
  }

  private async addRangeStylePatch(
    range: Range,
    patch: Partial<CellStyle>,
  ): Promise<void> {
    const normalizedStyle = this.normalizeStylePatch(patch);
    if (!normalizedStyle) {
      return;
    }

    const normalizedPatch = normalizeRangeStylePatch({
      range: cloneRange(range),
      style: normalizedStyle,
    });
    if (!normalizedPatch) {
      return;
    }

    const current = this.rangeStyles;

    // If the style only sets defaults and no layer needs overriding, skip.
    const prunedStyle = this.pruneRedundantDefaultStyleKeys(
      normalizedPatch.range,
      normalizedPatch.style,
    );
    if (!prunedStyle) {
      return;
    }
    normalizedPatch.style = prunedStyle;

    // If the newest patch targets the exact same range, merge style payloads
    // in place so repeated toggles do not keep appending redundant patches.
    const tail = current[current.length - 1];
    if (tail && isSameRange(tail.range, normalizedPatch.range)) {
      const mergedTailStyle = this.mergeStylePatch(
        tail.style,
        normalizedPatch.style,
      );
      if (!mergedTailStyle) {
        return;
      }

      const normalizedTailStyle = this.pruneRedundantDefaultStyleKeys(
        tail.range,
        mergedTailStyle,
        current.length - 1,
      );
      if (!normalizedTailStyle) {
        this.rangeStyles = current.slice(0, -1);
        this.compactShadowedRangeStyles();
        await this.store.setRangeStyles(this.rangeStyles);
        return;
      }

      if (stylesEqual(normalizedTailStyle, tail.style)) {
        return;
      }
      tail.style = { ...normalizedTailStyle };
      this.compactShadowedRangeStyles();
      await this.store.setRangeStyles(this.rangeStyles);
      return;
    }

    let nextPatch = normalizedPatch;
    let replaceFrom = current.length;

    for (let i = current.length - 1; i >= 0; i--) {
      const prev = current[i];
      const merged = this.tryMergeRangeStylePatches(prev, nextPatch);
      if (!merged) {
        break;
      }

      // New patch is fully absorbed by existing tail patch: no-op.
      if (isSameRange(merged.range, prev.range)) {
        if (i === current.length - 1) {
          return;
        }

        this.rangeStyles = current.slice(0, i + 1);
        this.compactShadowedRangeStyles();
        await this.store.setRangeStyles(this.rangeStyles);
        return;
      }

      nextPatch = merged;
      replaceFrom = i;
    }

    if (replaceFrom === current.length) {
      this.rangeStyles.push(nextPatch);
      await this.store.addRangeStyle(nextPatch);
      if (this.compactShadowedRangeStyles()) {
        await this.store.setRangeStyles(this.rangeStyles);
      }
      return;
    }

    this.rangeStyles = [...current.slice(0, replaceFrom), nextPatch];
    this.compactShadowedRangeStyles();
    await this.store.setRangeStyles(this.rangeStyles);
  }

  private async applyStylePatchToExistingCells(
    range: Range,
    patch: Partial<CellStyle>,
  ): Promise<void> {
    const normalizedStyle = this.normalizeStylePatch(patch);
    if (!normalizedStyle) {
      return;
    }

    const grid = await this.store.getGrid(range);
    const visited = new Set<Sref>();
    for (const [sref] of grid) {
      const ref = parseRef(sref);
      const anchor = this.normalizeRefToAnchor(ref);
      const anchorSref = toSref(anchor);
      if (visited.has(anchorSref)) {
        continue;
      }
      visited.add(anchorSref);

      const existing = await this.store.get(anchor);
      if (!existing?.s) {
        continue;
      }

      const conflictPatch: Partial<
        Record<keyof CellStyle, CellStyle[keyof CellStyle]>
      > = {};
      for (const key of Object.keys(normalizedStyle) as Array<keyof CellStyle>) {
        const prev = existing.s[key];
        const next = normalizedStyle[key];
        if (prev === undefined || prev === next) {
          continue;
        }
        conflictPatch[key] = next as CellStyle[keyof CellStyle];
      }

      if (Object.keys(conflictPatch).length === 0) {
        continue;
      }

      await this.setStyle(anchor, conflictPatch as Partial<CellStyle>);
    }
  }

  /**
   * `compactCell` removes undefined fields to keep persisted cell payload minimal.
   */
  private compactCell(base: Cell, style?: CellStyle): Cell {
    const cell: Cell = {};
    if (base.v !== undefined) {
      cell.v = base.v;
    }
    if (base.f !== undefined) {
      cell.f = base.f;
    }
    if (style && Object.keys(style).length > 0) {
      cell.s = style;
    }
    return cell;
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
    const rangeStyles = clipRangeStylePatches(this.rangeStyles, range);
    const text = grid2string(grid);
    this.copyBuffer = { sourceRange: range, grid, rangeStyles, text };
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
    let rangeStylePatches: RangeStylePatch[] = [];
    let shouldInferPastedInput = false;

    if (this.copyBuffer && text === this.copyBuffer.text) {
      // Internal paste: relocate formulas based on position delta
      grid = this.relocateGrid(
        this.copyBuffer.grid,
        this.copyBuffer.sourceRange,
        this.activeCell,
      );
      const deltaRow = this.activeCell.r - this.copyBuffer.sourceRange[0].r;
      const deltaCol = this.activeCell.c - this.copyBuffer.sourceRange[0].c;
      rangeStylePatches = translateRangeStylePatches(
        this.copyBuffer.rangeStyles,
        deltaRow,
        deltaCol,
      );
    } else if (html && isSpreadsheetHtml(html)) {
      // Spreadsheet HTML paste (Google Sheets / Excel)
      grid = html2grid(html, this.activeCell);
      shouldInferPastedInput = true;
    } else if (text) {
      // Plain TSV paste
      grid = string2grid(this.activeCell, text);
      shouldInferPastedInput = true;
    } else {
      return;
    }

    if (shouldInferPastedInput) {
      grid = this.applyInputInferenceToGrid(grid);
    }

    this.store.beginBatch();
    try {
      await this.setGrid(grid);
      for (const patch of rangeStylePatches) {
        await this.addRangeStylePatch(patch.range, patch.style);
        await this.applyStylePatchToExistingCells(patch.range, patch.style);
      }

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

      if (this.filterRange) {
        await this.recomputeFilterHiddenRows();
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
   * `computeAutofillRange` returns the expanded fill range, or undefined
   * when `target` is inside the source range.
   */
  private computeAutofillRange(
    sourceRange: Range,
    target: Ref,
  ): Range | undefined {
    if (inRange(target, sourceRange)) {
      return undefined;
    }
    return mergeRanges(sourceRange, [target, target]);
  }

  /**
   * `getAutofillPreviewRange` returns the current preview range for fill-handle drag.
   */
  public getAutofillPreviewRange(target: Ref): Range | undefined {
    if (this.selectionType !== 'cell') {
      return undefined;
    }
    const sourceRange = this.getRangeOrActiveCell();
    return this.computeAutofillRange(sourceRange, target);
  }

  /**
   * `positiveMod` returns a positive modulo result for wrap-around indexing.
   */
  private positiveMod(value: number, mod: number): number {
    return ((value % mod) + mod) % mod;
  }

  /**
   * `cloneCellForAutofill` clones a source cell for a destination position.
   * Formula cells are relocated and their cached values are dropped.
   */
  private cloneCellForAutofill(
    sourceCell: Cell,
    deltaRow: number,
    deltaCol: number,
  ): Cell {
    if (sourceCell.f) {
      const formula = relocateFormula(sourceCell.f, deltaRow, deltaCol);
      return sourceCell.s ? { f: formula, s: { ...sourceCell.s } } : { f: formula };
    }

    const next: Cell = {};
    if (sourceCell.v !== undefined) {
      next.v = sourceCell.v;
    }
    if (sourceCell.s) {
      next.s = { ...sourceCell.s };
    }
    return next;
  }

  /**
   * `autofill` fills from the current selected range to include `target`.
   * Pattern repeats by wrapping source rows/columns; formulas are relocated.
   */
  public async autofill(target: Ref): Promise<boolean> {
    if (this.selectionType !== 'cell') {
      return false;
    }

    const sourceRange = cloneRange(this.getRangeOrActiveCell());
    const fillRange = this.computeAutofillRange(sourceRange, target);
    if (!fillRange) {
      return false;
    }

    // Keep first version conservative: block autofill across merged blocks.
    if (this.getMergesIntersecting(fillRange).length > 0) {
      return false;
    }

    const sourceGrid = await this.store.getGrid(sourceRange);
    const sourceRowCount = sourceRange[1].r - sourceRange[0].r + 1;
    const sourceColCount = sourceRange[1].c - sourceRange[0].c + 1;
    const changedSrefs = new Set<Sref>();

    this.store.beginBatch();
    try {
      for (let r = fillRange[0].r; r <= fillRange[1].r; r++) {
        for (let c = fillRange[0].c; c <= fillRange[1].c; c++) {
          const dest = { r, c };
          if (inRange(dest, sourceRange)) {
            continue;
          }

          const sourceRef = {
            r:
              sourceRange[0].r +
              this.positiveMod(dest.r - sourceRange[0].r, sourceRowCount),
            c:
              sourceRange[0].c +
              this.positiveMod(dest.c - sourceRange[0].c, sourceColCount),
          };
          const sourceCell = sourceGrid.get(toSref(sourceRef));
          const normalizedDest = this.normalizeRefToAnchor(dest);
          const normalizedDestSref = toSref(normalizedDest);

          if (!sourceCell) {
            await this.store.delete(normalizedDest);
            changedSrefs.add(normalizedDestSref);
            continue;
          }

          const deltaRow = dest.r - sourceRef.r;
          const deltaCol = dest.c - sourceRef.c;
          const nextCell = this.cloneCellForAutofill(sourceCell, deltaRow, deltaCol);

          if (this.isEmptyCell(nextCell)) {
            await this.store.delete(normalizedDest);
          } else {
            await this.store.set(normalizedDest, nextCell);
          }
          changedSrefs.add(normalizedDestSref);
        }
      }

      if (changedSrefs.size > 0) {
        const expanded = this.expandChangedSrefsWithMergeAliases(changedSrefs);
        const dependantsMap = await this.store.buildDependantsMap(expanded);
        await calculate(this, dependantsMap, expanded);
      }

      if (this.filterRange) {
        await this.recomputeFilterHiddenRows();
      }
    } finally {
      this.store.endBatch();
    }

    if (changedSrefs.size === 0) {
      return false;
    }

    this.selectionType = 'cell';
    this.range = fillRange;
    return true;
  }

  /**
   * `hasContents` checks if the given range has cell contents.
   * Style-only cells are ignored.
   */
  async hasContents(range: Range): Promise<boolean> {
    const grid = await this.store.getGrid(range);
    for (const cell of grid.values()) {
      if (this.hasCellContent(cell)) {
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
      if (this.filterRange) {
        await this.recomputeFilterHiddenRows();
      }
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
   * `createFilterFromSelection` enables filtering for the current cell selection.
   * The top row is treated as the filter header row.
   */
  async createFilterFromSelection(): Promise<boolean> {
    if (this.selectionType !== 'cell') {
      return false;
    }

    const range = this.getRangeOrActiveCell();
    const expandedRange = await this.expandFilterRangeForHeaderOnlySelection(range);
    return this.setFilterRange(expandedRange);
  }

  /**
   * `expandFilterRangeForHeaderOnlySelection` extends a single-row selection
   * downward to contiguous data rows in the selected columns.
   */
  private async expandFilterRangeForHeaderOnlySelection(range: Range): Promise<Range> {
    const normalized = toRange(range[0], range[1]);
    if (normalized[0].r !== normalized[1].r) {
      return normalized;
    }

    const headerRow = normalized[0].r;
    if (headerRow >= this.dimension.rows) {
      return normalized;
    }

    const scanRange: Range = [
      { r: headerRow + 1, c: normalized[0].c },
      { r: this.dimension.rows, c: normalized[1].c },
    ];
    const grid = await this.store.getGrid(scanRange);
    if (grid.size === 0) {
      return normalized;
    }

    const rowsWithContent = new Set<number>();
    for (const [sref, cell] of grid) {
      if (!this.hasCellContent(cell)) {
        continue;
      }
      rowsWithContent.add(parseRef(sref).r);
    }

    let endRow = headerRow;
    while (rowsWithContent.has(endRow + 1)) {
      endRow += 1;
    }

    return toRange(normalized[0], { r: endRow, c: normalized[1].c });
  }

  /**
   * `setFilterRange` sets the filter range (header row included).
   */
  async setFilterRange(range: Range): Promise<boolean> {
    const normalized = toRange(range[0], range[1]);
    // Require at least one data row below the header.
    if (normalized[1].r <= normalized[0].r) {
      return false;
    }

    this.store.beginBatch();
    try {
      this.filterRange = normalized;
      this.normalizeFilterColumnsToRange();
      await this.recomputeFilterHiddenRows();
    } finally {
      this.store.endBatch();
    }
    return true;
  }

  /**
   * `clearFilter` removes all filter criteria and row visibility state.
   */
  async clearFilter(): Promise<void> {
    this.store.beginBatch();
    try {
      this.filterRange = undefined;
      this.filterColumns.clear();
      this.hiddenRows.clear();
      await this.store.setFilterState(undefined);
    } finally {
      this.store.endBatch();
    }
  }

  /**
   * `setColumnFilter` sets or updates a filter condition on a column.
   */
  async setColumnFilter(
    col: number,
    condition: FilterCondition,
  ): Promise<boolean> {
    if (!this.filterRange || !this.isColumnInFilter(col)) {
      return false;
    }

    this.store.beginBatch();
    try {
      const normalized = this.normalizeFilterCondition(condition);
      if (!normalized) {
        this.filterColumns.delete(col);
      } else {
        this.filterColumns.set(col, normalized);
      }
      await this.recomputeFilterHiddenRows();
    } finally {
      this.store.endBatch();
    }
    return true;
  }

  /**
   * `filterColumnByValue` applies an equals filter using `value` on `col`.
   */
  async filterColumnByValue(col: number, value: string): Promise<boolean> {
    return this.setColumnFilter(col, { op: 'equals', value });
  }

  /**
   * `clearColumnFilter` removes filter criteria for a single column.
   */
  async clearColumnFilter(col: number): Promise<boolean> {
    if (!this.filterRange || !this.isColumnInFilter(col)) {
      return false;
    }
    if (!this.filterColumns.has(col)) {
      return false;
    }

    this.store.beginBatch();
    try {
      this.filterColumns.delete(col);
      await this.recomputeFilterHiddenRows();
    } finally {
      this.store.endBatch();
    }
    return true;
  }

  /**
   * `getFilterColumnValues` returns distinct values and selected values for a column.
   * Distinct values are computed from rows that satisfy other column filters.
   */
  async getFilterColumnValues(
    col: number,
  ): Promise<{ values: string[]; selected: Set<string> } | undefined> {
    if (!this.filterRange || !this.isColumnInFilter(col)) {
      return undefined;
    }

    const distinct = new Set<string>();
    const dataStart = this.filterRange[0].r + 1;
    const dataEnd = this.filterRange[1].r;
    for (let row = dataStart; row <= dataEnd; row++) {
      if (!(await this.rowMatchesFilters(row, col))) {
        continue;
      }
      const cell = await this.getCell({ r: row, c: col });
      const value = this.normalizeFilterText(
        (cell as { v?: unknown } | undefined)?.v,
      );
      distinct.add(value.trim());
    }

    const values = Array.from(distinct).sort((a, b) =>
      a.localeCompare(b, undefined, { sensitivity: 'base' }),
    );

    const condition = this.filterColumns.get(col);
    if (!condition) {
      return { values, selected: new Set(values) };
    }

    if (condition.op === 'in') {
      return {
        values,
        selected: new Set(
          (condition.values || []).map((value) =>
            this.normalizeFilterText(value).trim(),
          ),
        ),
      };
    }

    return {
      values,
      selected: new Set(
        values.filter((value) => this.matchesFilterCondition(value, condition)),
      ),
    };
  }

  /**
   * `setColumnIncludedValues` filters a column by an explicit set of values.
   */
  async setColumnIncludedValues(col: number, values: string[]): Promise<boolean> {
    if (!this.filterRange || !this.isColumnInFilter(col)) {
      return false;
    }

    const normalized = Array.from(
      new Set(
        values.map((value) => this.normalizeFilterText(value).trim()),
      ),
    ).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));

    const options = await this.getFilterColumnValues(col);
    if (!options) return false;

    const optionSet = new Set(options.values);
    const valid = normalized.filter((value) => optionSet.has(value));

    this.store.beginBatch();
    try {
      if (valid.length === options.values.length) {
        this.filterColumns.delete(col);
      } else {
        this.filterColumns.set(col, { op: 'in', values: valid });
      }
      await this.recomputeFilterHiddenRows();
    } finally {
      this.store.endBatch();
    }
    return true;
  }

  /**
   * `sortFilterByColumn` sorts filter data rows by a column value.
   */
  async sortFilterByColumn(
    col: number,
    direction: 'asc' | 'desc',
  ): Promise<boolean> {
    if (!this.filterRange || !this.isColumnInFilter(col)) {
      return false;
    }

    const dataStart = this.filterRange[0].r + 1;
    const dataEnd = this.filterRange[1].r;
    if (dataEnd <= dataStart) {
      return false;
    }

    // Keep first iteration conservative: block sorting ranges with merges.
    const fullRowRange: Range = [
      { r: dataStart, c: 1 },
      { r: dataEnd, c: this.dimension.columns },
    ];
    if (this.getMergesIntersecting(fullRowRange).length > 0) {
      return false;
    }

    const rows: Array<{ row: number; text: string; lower: string; numeric: number | null }> = [];
    for (let row = dataStart; row <= dataEnd; row++) {
      const cell = await this.getCell({ r: row, c: col });
      const text = this.normalizeFilterText(
        (cell as { v?: unknown } | undefined)?.v,
      ).trim();
      const numeric = text.length > 0 && Number.isFinite(Number(text)) ? Number(text) : null;
      rows.push({ row, text, lower: text.toLowerCase(), numeric });
    }

    rows.sort((a, b) => {
      const aEmpty = a.text.length === 0;
      const bEmpty = b.text.length === 0;
      if (aEmpty && !bEmpty) return 1;
      if (!aEmpty && bEmpty) return -1;

      let compared = 0;
      if (a.numeric !== null && b.numeric !== null) {
        compared = a.numeric - b.numeric;
      } else {
        compared = a.lower.localeCompare(b.lower, undefined, {
          sensitivity: 'base',
        });
      }
      if (compared === 0) {
        compared = a.row - b.row;
      }
      return direction === 'asc' ? compared : -compared;
    });

    // Reorder rows by repeated single-row upward moves.
    const desired = rows.map((entry) => entry.row);
    const current = Array.from({ length: dataEnd - dataStart + 1 }, (_, i) => dataStart + i);
    const moves: Array<{ srcIndex: number; dstIndex: number }> = [];

    for (let i = 0; i < desired.length; i++) {
      const wantedRow = desired[i];
      const srcPos = current.indexOf(wantedRow);
      if (srcPos === -1 || srcPos === i) continue;

      const srcIndex = dataStart + srcPos;
      const dstIndex = dataStart + i;
      moves.push({ srcIndex, dstIndex });

      current.splice(srcPos, 1);
      current.splice(i, 0, wantedRow);
    }

    if (moves.length === 0) {
      return true;
    }

    this.store.beginBatch();
    try {
      for (const move of moves) {
        await this.moveCells(
          'row',
          move.srcIndex,
          1,
          move.dstIndex,
          { skipPostRecalculate: true },
        );
      }
      await this.recalculateAllFormulaCells();
      await this.recomputeFilterHiddenRows();
    } finally {
      this.store.endBatch();
    }

    return true;
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
    let target = this.normalizeRefToAnchor(ref);
    if (
      (direction === 'up' || direction === 'down') &&
      this.hiddenRows.has(target.r)
    ) {
      const nextVisible = this.findNextVisibleRow(target.r, direction);
      if (nextVisible === undefined) {
        return false;
      }
      target = this.normalizeRefToAnchor({ r: nextVisible, c: target.c });
    }

    if (isSameRef(this.activeCell, target)) {
      return false;
    }

    this.range = undefined;
    this.setActiveCell(target);
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

    if ((direction === 'up' || direction === 'down') && this.hiddenRows.has(row)) {
      const nextVisible = this.findNextVisibleRow(row, direction);
      if (nextVisible === undefined) {
        return false;
      }
      row = nextVisible;
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

    if (rowDelta !== 0) {
      const nextDirection = rowDelta > 0 ? 'down' : 'up';
      const resolveNextRow = (row: number): number | undefined => {
        if (!this.hiddenRows.has(row)) {
          return row;
        }
        return this.findNextVisibleRow(row, nextDirection);
      };

      if (this.activeCell.r === range[1].r) {
        const nextRow = resolveNextRow(range[0].r + rowDelta);
        if (nextRow === undefined) {
          return false;
        }
        range[0].r = nextRow;
      } else {
        const nextRow = resolveNextRow(range[1].r + rowDelta);
        if (nextRow === undefined) {
          return false;
        }
        range[1].r = nextRow;
      }
    }

    if (colDelta !== 0) {
      if (this.activeCell.c === range[1].c) {
        range[0].c += colDelta;
      } else {
        range[1].c += colDelta;
      }
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
   * `undefined` keys are ignored; explicit `false`/`0`/`""` are preserved.
   */
  async setStyle(ref: Ref, style: Partial<CellStyle>): Promise<void> {
    const patch = this.normalizeStylePatch(style);
    if (!patch) {
      return;
    }

    const anchor = this.normalizeRefToAnchor(ref);
    const cell = (await this.store.get(anchor)) || {};
    const merged = this.mergeStylePatch(cell.s, patch);

    const newCell = this.compactCell(cell, merged);
    if (this.isEmptyCell(newCell)) {
      await this.store.delete(anchor);
      return;
    }
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
          const merged = this.mergeStylePatch(this.colStyles.get(c), style);
          if (!merged) {
            continue;
          }
          this.colStyles.set(c, merged);
          await this.store.setColumnStyle(c, merged);
        }
        return;
      }

      if (this.selectionType === 'row') {
        const range = this.getRangeOrActiveCell();
        for (let r = range[0].r; r <= range[1].r; r++) {
          const merged = this.mergeStylePatch(this.rowStyles.get(r), style);
          if (!merged) {
            continue;
          }
          this.rowStyles.set(r, merged);
          await this.store.setRowStyle(r, merged);
        }
        return;
      }

      if (this.selectionType === 'all') {
        const merged = this.mergeStylePatch(this.sheetStyle, style);
        if (!merged) {
          return;
        }
        this.sheetStyle = merged;
        await this.store.setSheetStyle(merged);
        return;
      }

      // Default: append range patch and only touch already-populated cells.
      const range = this.getRangeOrActiveCell();
      await this.addRangeStylePatch(range, style);
      await this.applyStylePatchToExistingCells(range, style);
    } finally {
      this.store.endBatch();
    }
  }

  /**
   * `setConditionalFormats` replaces all conditional formatting rules.
   */
  async setConditionalFormats(rules: ConditionalFormatRule[]): Promise<void> {
    const normalized = rules
      .map((rule) => normalizeConditionalFormatRule(rule))
      .filter((rule): rule is ConditionalFormatRule => !!rule)
      .map((rule) => cloneConditionalFormatRule(rule));

    this.conditionalFormats = normalized;
    await this.store.setConditionalFormats(this.conditionalFormats);
  }

  /**
   * `setRangeBorders` applies a border preset to the current cell selection.
   * Border presets are only supported for cell selections.
   */
  async setRangeBorders(preset: BorderPreset): Promise<boolean> {
    if (this.selectionType !== 'cell') {
      return false;
    }

    const selection = this.getRangeOrActiveCell();
    const rows = selection[1].r - selection[0].r + 1;
    const cols = selection[1].c - selection[0].c + 1;
    if (rows * cols > MaxBorderSelectionCells) {
      return false;
    }

    const targets = this.collectBorderTargets(selection);
    this.store.beginBatch();
    try {
      for (const { anchor, range } of targets) {
        const patch = this.toBorderPatchForPreset(preset, selection, range);
        await this.setStyle(anchor, patch);
      }
    } finally {
      this.store.endBatch();
    }

    return true;
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

  private collectBorderTargets(
    selection: Range,
  ): Array<{ anchor: Ref; range: Range }> {
    const targets: Array<{ anchor: Ref; range: Range }> = [];
    const visited = new Set<Sref>();

    for (let r = selection[0].r; r <= selection[1].r; r++) {
      for (let c = selection[0].c; c <= selection[1].c; c++) {
        const anchor = this.normalizeRefToAnchor({ r, c });
        const anchorSref = toSref(anchor);
        if (visited.has(anchorSref)) {
          continue;
        }
        visited.add(anchorSref);

        const span = this.merges.get(anchorSref);
        const range = span ? toMergeRange(anchor, span) : toRange(anchor, anchor);
        targets.push({ anchor, range });
      }
    }

    return targets;
  }

  private toBorderPatchForPreset(
    preset: BorderPreset,
    selection: Range,
    target: Range,
  ): Partial<CellStyle> {
    const onTop = target[0].r === selection[0].r;
    const onBottom = target[1].r === selection[1].r;
    const onLeft = target[0].c === selection[0].c;
    const onRight = target[1].c === selection[1].c;

    switch (preset) {
      case 'all':
        return {
          bt: true,
          bl: true,
          br: onRight,
          bb: onBottom,
        };
      case 'outer':
        return {
          bt: onTop,
          bl: onLeft,
          br: onRight,
          bb: onBottom,
        };
      case 'inner':
        return {
          bt: !onTop,
          bl: !onLeft,
          br: false,
          bb: false,
        };
      case 'top':
        return { bt: onTop };
      case 'bottom':
        return { bb: onBottom };
      case 'left':
        return { bl: onLeft };
      case 'right':
        return { br: onRight };
      case 'clear':
      default:
        return {
          bt: false,
          bl: false,
          br: false,
          bb: false,
        };
    }
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
      await this.loadFilterState();

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
      await this.loadFilterState();

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
