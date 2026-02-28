import {
  Axis,
  Cell,
  CellStyle,
  ConditionalFormatRule,
  FilterState,
  Grid,
  HiddenState,
  MergeSpan,
  Ref,
  Range,
  Sref,
  Direction,
} from '../model/types';
import { RangeStylePatch } from '../model/range-styles';

/**
 * `Store` interface represents a storage that stores the cell values.
 */
export interface Store {
  /**
   * `set` method sets the value of a cell.
   */
  set(ref: Ref, value: Cell): Promise<void>;

  /**
   * `get` method gets the value of a cell.
   */
  get(ref: Ref): Promise<Cell | undefined>;

  /**
   * `has` method checks if a cell exists.
   */
  has(ref: Ref): Promise<boolean>;

  /**
   * `delete` method deletes a cell.
   */
  delete(ref: Ref): Promise<boolean>;

  /**
   * `deleteRange` method deletes all cells within the given range.
   * Returns the set of Srefs that were actually deleted.
   */
  deleteRange(range: Range): Promise<Set<Sref>>;

  /**
   * `setGrid` method sets the grid.
   */
  setGrid(grid: Grid): Promise<void>;

  /**
   * `getGrid` method gets the grid.
   */
  getGrid(range: Range): Promise<Grid>;

  /**
   * `findEgde` method finds the edge of the grid.
   */
  findEdge(ref: Ref, direction: Direction, dimension: Range): Promise<Ref>;

  /**
   * `getFormulaGrid` method returns all cells that have formulas.
   */
  getFormulaGrid(): Promise<Grid>;

  /**
   * `buildDependantsMap` method builds a map of dependants.
   */
  buildDependantsMap(srefs: Iterable<Sref>): Promise<Map<Sref, Set<Sref>>>;

  /**
   * `getPresences` method gets the user presences.
   */
  getPresences(): Array<{ clientID: string; presence: { activeCell: string } }>;

  /**
   * `shiftCells` method shifts cells along the given axis.
   * Positive count inserts, negative count deletes.
   */
  shiftCells(axis: Axis, index: number, count: number): Promise<void>;

  /**
   * `moveCells` method moves cells along the given axis.
   * Moves `count` rows/columns starting at `srcIndex` to before `dstIndex`.
   */
  moveCells(
    axis: Axis,
    srcIndex: number,
    count: number,
    dstIndex: number,
  ): Promise<void>;

  /**
   * `setDimensionSize` method sets a custom row height or column width.
   */
  setDimensionSize(axis: Axis, index: number, size: number): Promise<void>;

  /**
   * `getDimensionSizes` method gets all custom row heights or column widths.
   */
  getDimensionSizes(axis: Axis): Promise<Map<number, number>>;

  /**
   * `setColumnStyle` method sets the style for an entire column.
   */
  setColumnStyle(col: number, style: CellStyle): Promise<void>;

  /**
   * `getColumnStyles` method gets all column-level styles.
   */
  getColumnStyles(): Promise<Map<number, CellStyle>>;

  /**
   * `setRowStyle` method sets the style for an entire row.
   */
  setRowStyle(row: number, style: CellStyle): Promise<void>;

  /**
   * `getRowStyles` method gets all row-level styles.
   */
  getRowStyles(): Promise<Map<number, CellStyle>>;

  /**
   * `setSheetStyle` method sets the default style for the entire sheet.
   */
  setSheetStyle(style: CellStyle): Promise<void>;

  /**
   * `getSheetStyle` method gets the sheet-level default style.
   */
  getSheetStyle(): Promise<CellStyle | undefined>;

  /**
   * `addRangeStyle` method appends a range style patch.
   */
  addRangeStyle(patch: RangeStylePatch): Promise<void>;

  /**
   * `setRangeStyles` method replaces all range style patches.
   */
  setRangeStyles(patches: RangeStylePatch[]): Promise<void>;

  /**
   * `getRangeStyles` method gets all range style patches in apply order.
   */
  getRangeStyles(): Promise<RangeStylePatch[]>;

  /**
   * `setConditionalFormats` replaces all conditional format rules.
   */
  setConditionalFormats(rules: ConditionalFormatRule[]): Promise<void>;

  /**
   * `getConditionalFormats` gets all conditional format rules in apply order.
   */
  getConditionalFormats(): Promise<ConditionalFormatRule[]>;

  /**
   * `setMerge` sets a merged range anchor with row/column span.
   */
  setMerge(anchor: Ref, span: MergeSpan): Promise<void>;

  /**
   * `deleteMerge` removes a merged range anchor.
   */
  deleteMerge(anchor: Ref): Promise<boolean>;

  /**
   * `getMerges` gets all merged range anchors in the worksheet.
   */
  getMerges(): Promise<Map<Sref, MergeSpan>>;

  /**
   * `setFilterState` sets worksheet-level filter state.
   */
  setFilterState(state: FilterState | undefined): Promise<void>;

  /**
   * `getFilterState` gets worksheet-level filter state.
   */
  getFilterState(): Promise<FilterState | undefined>;

  /**
   * `setHiddenState` sets manually hidden rows/columns.
   */
  setHiddenState(state: HiddenState | undefined): Promise<void>;

  /**
   * `getHiddenState` gets manually hidden rows/columns.
   */
  getHiddenState(): Promise<HiddenState | undefined>;

  /**
   * `updateActiveCell` method updates the active cell of the current user.
   */
  updateActiveCell(activeCell: Ref): void;

  /**
   * `setFreezePane` method sets the freeze pane position.
   */
  setFreezePane(frozenRows: number, frozenCols: number): Promise<void>;

  /**
   * `getFreezePane` method gets the freeze pane position.
   */
  getFreezePane(): Promise<{ frozenRows: number; frozenCols: number }>;

  /**
   * `beginBatch` starts a batch transaction. All mutations between
   * `beginBatch()` and `endBatch()` are grouped into a single undo step.
   */
  beginBatch(): void;

  /**
   * `endBatch` ends the batch transaction, flushing all buffered mutations
   * in a single store update.
   */
  endBatch(): void;

  /**
   * `undo` method undoes the last local change.
   * Returns an object with `success` and optionally `affectedRange`.
   */
  undo(): Promise<{ success: boolean; affectedRange?: Range }>;

  /**
   * `redo` method redoes the last undone change.
   * Returns an object with `success` and optionally `affectedRange`.
   */
  redo(): Promise<{ success: boolean; affectedRange?: Range }>;

  /**
   * `canUndo` method returns true if there is a change to undo.
   */
  canUndo(): boolean;

  /**
   * `canRedo` method returns true if there is a change to redo.
   */
  canRedo(): boolean;
}
