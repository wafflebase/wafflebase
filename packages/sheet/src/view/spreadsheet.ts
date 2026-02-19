import {
  BorderPreset,
  CellStyle,
  FilterCondition,
  GridResolver,
  Range,
  Ref,
  SelectionType,
} from '../model/types';
import { Sheet } from '../model/sheet';
import { Store } from '../store/store';
import { MemStore } from '../store/memory';
import { Worksheet } from './worksheet';

export type Theme = 'light' | 'dark';

export interface Options {
  theme?: Theme;
  store?: Store;
  readOnly?: boolean;
}

export type LayoutRect = {
  left: number;
  top: number;
  width: number;
  height: number;
};

/**
 * setupSpreadsheet sets up the spreadsheet in the given container.
 * @param container Container element to render the spreadsheet.
 * @param options Optional setup options.
 * @returns A function to clean up the spreadsheet.
 */
export async function initialize(
  container: HTMLDivElement,
  options?: Options,
): Promise<Spreadsheet> {
  const spreadsheet = new Spreadsheet(container, options);
  const store = options?.store || new MemStore();
  await spreadsheet.initialize(store);
  return spreadsheet;
}

export type SelectionChangeCallback = () => void;

/**
 * Spreadsheet is a class that represents a spreadsheet.
 */
export class Spreadsheet {
  private container: HTMLDivElement;
  private worksheet: Worksheet;
  private sheet?: Sheet;
  private theme: Theme;
  private _readOnly: boolean;
  private selectionChangeCallbacks: SelectionChangeCallback[] = [];

  /**
   * `constructor` initializes the spreadsheet with the given grid.
   */
  constructor(container: HTMLDivElement, options?: Options) {
    this.container = container;
    this.container.style.position = 'relative';
    this.container.style.overflow = 'hidden';
    this.theme = options?.theme || 'light';
    this._readOnly = options?.readOnly || false;

    this.worksheet = new Worksheet(this.container, this.theme, this._readOnly);
  }

  /**
   * `isReadOnly` returns whether the spreadsheet is in read-only mode.
   */
  public get readOnly(): boolean {
    return this._readOnly;
  }

  /**
   * `initialize` initializes the spreadsheet with the given store.
   */
  public async initialize(store: Store) {
    this.sheet = new Sheet(store);
    this.worksheet.setOnRender(() => this.notifySelectionChange());
    await this.worksheet.initialize(this.sheet);
  }

  /**
   * `reloadDimensions` reloads dimension sizes from the store and re-renders.
   * Call this when a remote change arrives to sync local DimensionIndex state.
   */
  public async reloadDimensions() {
    await this.worksheet.reloadDimensions();
  }

  /**
   * `setFreezePane` sets the freeze pane position and re-renders.
   */
  public async setFreezePane(frozenRows: number, frozenCols: number) {
    if (this._readOnly) return;
    await this.worksheet.setFreezePane(frozenRows, frozenCols);
  }

  /**
   * `render` renders the spreadsheet.
   */
  public render() {
    this.worksheet.render();
  }

  /**
   * `renderOverlay` renders the overlay on top of the sheet.
   */
  public renderOverlay() {
    this.worksheet.renderOverlay();
  }

  /**
   * `panBy` scrolls the viewport by logical pixel deltas.
   */
  public panBy(deltaX: number, deltaY: number) {
    this.worksheet.panBy(deltaX, deltaY);
  }

  /**
   * `handleMobileDoubleTap` enters edit mode for the tapped cell.
   */
  public handleMobileDoubleTap(clientX: number, clientY: number) {
    this.worksheet.handleMobileDoubleTap(clientX, clientY);
  }

  /**
   * `applyStyle` applies the given style to the current selection and re-renders.
   */
  public async applyStyle(style: Partial<CellStyle>) {
    if (!this.sheet || this._readOnly) return;
    await this.sheet.setRangeStyle(style);
    this.worksheet.render();
    this.notifySelectionChange();
  }

  /**
   * `applyBorders` applies a border preset to the current selection and re-renders.
   */
  public async applyBorders(preset: BorderPreset) {
    if (!this.sheet || this._readOnly) return;
    if (await this.sheet.setRangeBorders(preset)) {
      this.worksheet.render();
      this.notifySelectionChange();
    }
  }

  /**
   * `toggleStyle` toggles a boolean style property on the current selection and re-renders.
   */
  public async toggleStyle(prop: 'b' | 'i' | 'u' | 'st') {
    if (!this.sheet || this._readOnly) return;
    await this.sheet.toggleRangeStyle(prop);
    this.worksheet.render();
    this.notifySelectionChange();
  }

  /**
   * `getActiveStyle` returns the style of the active cell.
   */
  public async getActiveStyle(): Promise<CellStyle | undefined> {
    if (!this.sheet) return undefined;
    return this.sheet.getStyle(this.sheet.getActiveCell());
  }

  /**
   * `onSelectionChange` registers a callback that fires when the selection changes.
   * Returns an unsubscribe function.
   */
  public onSelectionChange(callback: SelectionChangeCallback): () => void {
    this.selectionChangeCallbacks.push(callback);
    return () => {
      this.selectionChangeCallbacks = this.selectionChangeCallbacks.filter(
        (cb) => cb !== callback,
      );
    };
  }

  /**
   * `notifySelectionChange` notifies all selection change callbacks.
   */
  public notifySelectionChange() {
    for (const cb of this.selectionChangeCallbacks) {
      cb();
    }
  }

  /**
   * `getSelectionType` returns the current selection type.
   */
  public getSelectionType(): SelectionType | undefined {
    return this.sheet?.getSelectionType();
  }

  /**
   * `getSelectionRangeOrActiveCell` returns the current selection range, or
   * active cell as a single-cell range.
   */
  public getSelectionRangeOrActiveCell(): Range | undefined {
    return this.sheet?.getRangeOrActiveCell();
  }

  /**
   * `getGridViewportRect` returns the grid viewport rectangle relative to the
   * worksheet container.
   */
  public getGridViewportRect(): LayoutRect {
    return this.worksheet.getGridViewportRect();
  }

  /**
   * `getScrollableGridViewportRect` returns the unfrozen scrollable viewport
   * rectangle (Quadrant D), relative to the worksheet container.
   */
  public getScrollableGridViewportRect(): LayoutRect {
    return this.worksheet.getScrollableGridViewportRect();
  }

  /**
   * `getCellRect` returns the on-screen rectangle for a given cell.
   */
  public getCellRect(ref: Ref): LayoutRect {
    return this.worksheet.getCellRect(ref);
  }

  /**
   * `getCellRectInScrollableViewport` returns the cell rectangle in unfrozen
   * scrollable-quadrant coordinates (Quadrant D).
   */
  public getCellRectInScrollableViewport(ref: Ref): LayoutRect {
    return this.worksheet.getCellRectInScrollableViewport(ref);
  }

  /**
   * `increaseDecimals` increases the decimal places for the current selection.
   */
  public async increaseDecimals() {
    if (!this.sheet || this._readOnly) return;
    const dp = await this.sheet.getActiveDecimalPlaces();
    await this.sheet.setRangeStyle({ dp: dp + 1 });
    this.worksheet.render();
    this.notifySelectionChange();
  }

  /**
   * `decreaseDecimals` decreases the decimal places for the current selection.
   */
  public async decreaseDecimals() {
    if (!this.sheet || this._readOnly) return;
    const dp = await this.sheet.getActiveDecimalPlaces();
    await this.sheet.setRangeStyle({ dp: Math.max(0, dp - 1) });
    this.worksheet.render();
    this.notifySelectionChange();
  }

  /**
   * `toggleMergeCells` merges/unmerges the current cell selection and re-renders.
   */
  public async toggleMergeCells() {
    if (!this.sheet || this._readOnly) return;
    if (await this.sheet.toggleMergeSelection()) {
      this.worksheet.render();
      this.notifySelectionChange();
    }
  }

  /**
   * `isSelectionMerged` returns whether current selection is a merged block.
   */
  public isSelectionMerged(): boolean {
    if (!this.sheet) return false;
    return this.sheet.isSelectionMerged();
  }

  /**
   * `canMergeSelection` returns whether current selection can be merged.
   */
  public canMergeSelection(): boolean {
    if (!this.sheet) return false;
    return this.sheet.canMergeSelection();
  }

  /**
   * `hasFilter` returns whether an active filter exists on the sheet.
   */
  public hasFilter(): boolean {
    return this.sheet?.hasFilter() || false;
  }

  /**
   * `createFilterFromSelection` creates a filter for the current cell selection.
   */
  public async createFilterFromSelection(): Promise<boolean> {
    if (!this.sheet || this._readOnly) return false;
    const created = await this.sheet.createFilterFromSelection();
    if (created) {
      this.worksheet.render();
      this.notifySelectionChange();
    }
    return created;
  }

  /**
   * `clearFilter` removes all active filters.
   */
  public async clearFilter(): Promise<void> {
    if (!this.sheet || this._readOnly) return;
    await this.sheet.clearFilter();
    this.worksheet.render();
    this.notifySelectionChange();
  }

  /**
   * `setColumnFilter` sets a condition on a filter column.
   */
  public async setColumnFilter(
    col: number,
    condition: FilterCondition,
  ): Promise<boolean> {
    if (!this.sheet || this._readOnly) return false;
    const changed = await this.sheet.setColumnFilter(col, condition);
    if (changed) {
      this.worksheet.render();
      this.notifySelectionChange();
    }
    return changed;
  }

  /**
   * `clearColumnFilter` removes a condition from a filter column.
   */
  public async clearColumnFilter(col: number): Promise<boolean> {
    if (!this.sheet || this._readOnly) return false;
    const changed = await this.sheet.clearColumnFilter(col);
    if (changed) {
      this.worksheet.render();
      this.notifySelectionChange();
    }
    return changed;
  }

  /**
   * `undo` undoes the last local change and re-renders.
   */
  public async undo() {
    if (!this.sheet || this._readOnly) return;
    if (await this.sheet.undo()) {
      this.worksheet.render();
      this.notifySelectionChange();
    }
  }

  /**
   * `redo` redoes the last undone change and re-renders.
   */
  public async redo() {
    if (!this.sheet || this._readOnly) return;
    if (await this.sheet.redo()) {
      this.worksheet.render();
      this.notifySelectionChange();
    }
  }

  /**
   * `toggleFunctionBrowser` toggles the function browser dialog.
   */
  public toggleFunctionBrowser() {
    this.worksheet.toggleFunctionBrowser();
  }

  public cleanup() {
    this.worksheet.cleanup();
    this.selectionChangeCallbacks = [];
  }

  /**
   * `setGridResolver` sets the resolver for cross-sheet formula references.
   */
  public setGridResolver(resolver: GridResolver): void {
    if (this.sheet) {
      this.sheet.setGridResolver(resolver);
    }
  }

  /**
   * `recalculateCrossSheetFormulas` re-evaluates all formulas that reference
   * other sheets and re-renders. Call when another sheet's data may have changed.
   */
  public async recalculateCrossSheetFormulas(): Promise<void> {
    if (!this.sheet) return;
    await this.sheet.recalculateCrossSheetFormulas();
    this.worksheet.render();
  }
}
