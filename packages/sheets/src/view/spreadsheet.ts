import {
  Axis,
  BorderPreset,
  CellStyle,
  ConditionalFormatRule,
  FilterCondition,
  FormulaResolver,
  GridResolver,
  Range,
  Ranges,
  Ref,
  SelectionType,
} from '../model/core/types';
import { Sheet } from '../model/worksheet/sheet';
import { Store } from '../store/store';
import { MemStore } from '../store/memory';
import { Worksheet } from './worksheet';

export type Theme = 'light' | 'dark';

export interface Options {
  theme?: Theme;
  store?: Store;
  readOnly?: boolean;
  hideFormulaBar?: boolean;
  hideAutofillHandle?: boolean;
  showMobileHandles?: boolean;
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
  private searchResults: Ref[] = [];
  private searchCurrentIndex: number = -1;

  /**
   * `constructor` initializes the spreadsheet with the given grid.
   */
  constructor(container: HTMLDivElement, options?: Options) {
    this.container = container;
    this.container.style.position = 'relative';
    this.container.style.overflow = 'hidden';
    this.theme = options?.theme || 'light';
    this._readOnly = options?.readOnly || false;

    this.worksheet = new Worksheet(this.container, this.theme, this._readOnly, options?.hideFormulaBar, options?.hideAutofillHandle, options?.showMobileHandles);
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
   * `invalidateStore` marks the store's cell index as stale so it is rebuilt
   * on the next read. Call this after external writes that bypass the store.
   */
  public invalidateStore(): void {
    this.sheet?.invalidateStore();
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
   * `setZoom` sets the zoom level (0.5–2.0) and re-renders.
   */
  public setZoom(level: number): void {
    this.worksheet.setZoom(level);
  }

  /**
   * `getZoom` returns the current zoom level.
   */
  public getZoom(): number {
    return this.worksheet.getZoom();
  }

  /**
   * `handleMobileDoubleTap` enters edit mode for the tapped cell.
   */
  public handleMobileDoubleTap(clientX: number, clientY: number) {
    this.worksheet.handleMobileDoubleTap(clientX, clientY);
  }

  /**
   * `detectMobileSelectionHandle` checks if client coordinates hit a
   * mobile selection handle. Returns 'start', 'end', or null.
   */
  public detectMobileSelectionHandle(
    clientX: number,
    clientY: number,
  ): 'start' | 'end' | null {
    return this.worksheet.detectMobileSelectionHandle(clientX, clientY);
  }

  /**
   * `startMobileHandleDrag` begins a touch-drag session for a mobile
   * selection handle.
   */
  public startMobileHandleDrag(handle: 'start' | 'end'): void {
    this.worksheet.startMobileHandleDrag(handle);
  }

  /**
   * `setMobileEditCallback` registers a callback invoked on mobile
   * double-tap instead of inline editing. The callback receives the
   * cell reference string (e.g. "A1") and its current value.
   */
  public setMobileEditCallback(
    cb: ((cellRef: string, value: string) => void) | null,
  ): void {
    this.worksheet.setMobileEditCallback(cb);
  }

  /**
   * `commitExternalEdit` writes a value to the active cell from an
   * external editor (e.g. the mobile edit panel). Re-renders the
   * sheet after committing.
   */
  public async commitExternalEdit(value: string): Promise<void> {
    if (!this.sheet || this._readOnly) return;
    const ref = this.sheet.getActiveCell();
    await this.sheet.setData(ref, value);
    await this.worksheet.autoResizeActiveRow();
    this.worksheet.render();
    this.notifySelectionChange();
  }

  /**
   * `focusCell` selects the target cell and scrolls it into view.
   */
  public async focusCell(ref: Ref): Promise<void> {
    if (!this.sheet) return;
    await this.worksheet.focusCell(ref);
    this.notifySelectionChange();
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
   * `applyDefaultStyle` resets the current cell selection to default style.
   */
  public async applyDefaultStyle() {
    if (!this.sheet || this._readOnly) return;
    if (await this.sheet.resetRangeStyleToDefault()) {
      this.worksheet.render();
      this.notifySelectionChange();
    }
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
   * `getActiveCell` returns the active cell reference.
   */
  public getActiveCell(): Ref | undefined {
    return this.sheet?.getActiveCell();
  }

  /**
   * `getConditionalFormats` returns conditional formatting rules.
   */
  public getConditionalFormats(): ConditionalFormatRule[] {
    return this.sheet?.getConditionalFormats() || [];
  }

  /**
   * `setConditionalFormats` replaces conditional formatting rules and re-renders.
   */
  public async setConditionalFormats(
    rules: ConditionalFormatRule[],
  ): Promise<void> {
    if (!this.sheet || this._readOnly) return;
    await this.sheet.setConditionalFormats(rules);
    this.worksheet.render();
    this.notifySelectionChange();
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
   * `getSelectionRanges` returns all currently selected ranges.
   */
  public getSelectionRanges(): Ranges {
    return this.sheet?.getRanges() ?? [];
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
   * `cellRefFromPoint` converts client (screen) coordinates to a cell reference.
   */
  public cellRefFromPoint(clientX: number, clientY: number): Ref {
    return this.worksheet.cellRefFromPoint(clientX, clientY);
  }

  /**
   * `selectEnd` extends the current selection to the given cell.
   */
  public selectEnd(ref: Ref): void {
    if (!this.sheet) return;
    this.sheet.selectEnd(ref);
    this.worksheet.render();
    this.notifySelectionChange();
  }

  /**
   * `selectStart` starts a new selection at the given cell.
   */
  public selectStart(ref: Ref): void {
    if (!this.sheet) return;
    this.sheet.selectStart(ref);
    this.worksheet.render();
    this.notifySelectionChange();
  }

  /**
   * `addSelection` starts a new selection while preserving existing ones (Ctrl+click).
   */
  public addSelection(ref: Ref): void {
    if (!this.sheet) return;
    this.sheet.addSelection(ref);
    this.worksheet.render();
    this.notifySelectionChange();
  }

  /**
   * `addSelectionEnd` extends the last range in multi-selection (Ctrl+Shift+drag).
   */
  public addSelectionEnd(ref: Ref): void {
    if (!this.sheet) return;
    this.sheet.addSelectionEnd(ref);
    this.worksheet.render();
    this.notifySelectionChange();
  }

  /**
   * `increaseDecimals` increases the decimal places for the current selection.
   */
  public async increaseDecimals() {
    if (!this.sheet || this._readOnly) return;
    const { dp, nf } = await this.sheet.getActiveDecimalState();
    const patch: Partial<CellStyle> = { dp: dp + 1 };
    if (!nf || nf === 'plain') {
      patch.nf = 'number';
    }
    await this.sheet.setRangeStyle(patch);
    this.worksheet.render();
    this.notifySelectionChange();
  }

  /**
   * `decreaseDecimals` decreases the decimal places for the current selection.
   */
  public async decreaseDecimals() {
    if (!this.sheet || this._readOnly) return;
    const { dp, nf } = await this.sheet.getActiveDecimalState();
    const patch: Partial<CellStyle> = { dp: Math.max(0, dp - 1) };
    if (!nf || nf === 'plain') {
      patch.nf = 'number';
    }
    await this.sheet.setRangeStyle(patch);
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
   * `copy` copies the current selection to the system clipboard.
   */
  public async copy(): Promise<void> {
    if (!this.sheet) return;
    try {
      const { text } = await this.sheet.copy();
      await navigator.clipboard.writeText(text);
    } catch (err) {
      console.error('Failed to copy cell content: ', err);
    }
  }

  /**
   * `cut` cuts the current selection to the system clipboard.
   */
  public async cut(): Promise<void> {
    if (!this.sheet || this._readOnly) return;
    try {
      const { text } = await this.sheet.cut();
      await navigator.clipboard.writeText(text);
      this.worksheet.renderOverlay();
    } catch (err) {
      console.error('Failed to cut cell content: ', err);
    }
  }

  /**
   * `paste` pastes from the system clipboard into the current selection.
   */
  public async paste(): Promise<void> {
    if (!this.sheet || this._readOnly) return;
    try {
      let text: string | undefined;
      let html: string | undefined;

      if (navigator.clipboard.read) {
        try {
          const items = await navigator.clipboard.read();
          for (const item of items) {
            if (item.types.includes('text/html')) {
              const blob = await item.getType('text/html');
              html = await blob.text();
            }
            if (item.types.includes('text/plain')) {
              const blob = await item.getType('text/plain');
              text = await blob.text();
            }
          }
        } catch {
          text = await navigator.clipboard.readText();
        }
      } else {
        text = await navigator.clipboard.readText();
      }

      await this.sheet.paste({ text, html });
      this.sheet.clearCopyBuffer();
      this.worksheet.render();
      this.notifySelectionChange();
    } catch (err) {
      console.error('Failed to paste cell content: ', err);
    }
  }

  /**
   * `removeData` deletes the contents of the current selection.
   */
  public async removeData(): Promise<void> {
    if (!this.sheet || this._readOnly) return;
    if (await this.sheet.removeData()) {
      this.worksheet.render();
      this.notifySelectionChange();
    }
  }

  /**
   * `selectRow` selects an entire row.
   */
  public selectRow(row: number): void {
    if (!this.sheet) return;
    this.sheet.selectRow(row);
    this.worksheet.render();
    this.notifySelectionChange();
  }

  /**
   * `selectColumn` selects an entire column.
   */
  public selectColumn(col: number): void {
    if (!this.sheet) return;
    this.sheet.selectColumn(col);
    this.worksheet.render();
    this.notifySelectionChange();
  }

  /**
   * `getSelectedIndices` returns the selected row/column range, or null for
   * cell/all selections.
   */
  public getSelectedIndices(): { axis: Axis; from: number; to: number } | null {
    return this.sheet?.getSelectedIndices() ?? null;
  }

  /**
   * `insertRows` inserts rows at the given index.
   */
  public async insertRows(index: number, count: number = 1): Promise<void> {
    if (!this.sheet || this._readOnly) return;
    await this.sheet.insertRows(index, count);
    this.worksheet.render();
    this.notifySelectionChange();
  }

  /**
   * `deleteRows` deletes rows at the given index.
   */
  public async deleteRows(index: number, count: number = 1): Promise<void> {
    if (!this.sheet || this._readOnly) return;
    await this.sheet.deleteRows(index, count);
    this.worksheet.render();
    this.notifySelectionChange();
  }

  /**
   * `insertColumns` inserts columns at the given index.
   */
  public async insertColumns(index: number, count: number = 1): Promise<void> {
    if (!this.sheet || this._readOnly) return;
    await this.sheet.insertColumns(index, count);
    this.worksheet.render();
    this.notifySelectionChange();
  }

  /**
   * `deleteColumns` deletes columns at the given index.
   */
  public async deleteColumns(index: number, count: number = 1): Promise<void> {
    if (!this.sheet || this._readOnly) return;
    await this.sheet.deleteColumns(index, count);
    this.worksheet.render();
    this.notifySelectionChange();
  }

  /**
   * `headerHitTest` checks if client coordinates fall on a row or column
   * header and returns the axis and 1-based index, or null if on the grid.
   */
  public headerHitTest(
    clientX: number,
    clientY: number,
  ): { axis: 'row' | 'column'; index: number } | null {
    return this.worksheet.headerHitTest(clientX, clientY);
  }

  /**
   * `toggleFunctionBrowser` toggles the function browser dialog.
   */
  public toggleFunctionBrowser() {
    this.worksheet.toggleFunctionBrowser();
  }

  public async hideRows(indices: number[]): Promise<void> {
    if (!this.sheet || this._readOnly) return;
    await this.sheet.hideRows(indices);
    this.worksheet.render();
  }

  public async showRows(indices: number[]): Promise<void> {
    if (!this.sheet || this._readOnly) return;
    await this.sheet.showRows(indices);
    this.worksheet.render();
  }

  public async hideColumns(indices: number[]): Promise<void> {
    if (!this.sheet || this._readOnly) return;
    await this.sheet.hideColumns(indices);
    this.worksheet.render();
  }

  public async showColumns(indices: number[]): Promise<void> {
    if (!this.sheet || this._readOnly) return;
    await this.sheet.showColumns(indices);
    this.worksheet.render();
  }

  public findAdjacentHiddenRows(from: number, to: number): number[] {
    return this.worksheet.findAdjacentHiddenRows(from, to);
  }

  public findAdjacentHiddenColumns(from: number, to: number): number[] {
    return this.worksheet.findAdjacentHiddenColumns(from, to);
  }

  /**
   * `find` searches for the given query in all cells and highlights matches.
   * Returns the number of matches found.
   */
  public async find(query: string, options?: { caseSensitive?: boolean }): Promise<number> {
    if (!this.sheet) return 0;
    if (!query) {
      this.clearFind();
      return 0;
    }
    this.searchResults = await this.sheet.findCells(query, options);
    if (this.searchResults.length > 0) {
      // Find the first match after the current active cell
      const active = this.sheet.getActiveCell();
      let idx = this.searchResults.findIndex(
        (ref) => ref.r > active.r || (ref.r === active.r && ref.c >= active.c),
      );
      if (idx === -1) idx = 0;
      this.searchCurrentIndex = idx;
      await this.focusCell(this.searchResults[idx]);
    } else {
      this.searchCurrentIndex = -1;
    }
    this.worksheet.setSearchHighlights(this.searchResults, this.searchCurrentIndex);
    this.worksheet.renderOverlay();
    return this.searchResults.length;
  }

  /**
   * `findNext` moves to the next search result. Wraps around.
   */
  public async findNext(): Promise<void> {
    if (this.searchResults.length === 0) return;
    this.searchCurrentIndex = (this.searchCurrentIndex + 1) % this.searchResults.length;
    await this.focusCell(this.searchResults[this.searchCurrentIndex]);
    this.worksheet.setSearchHighlights(this.searchResults, this.searchCurrentIndex);
    this.worksheet.renderOverlay();
  }

  /**
   * `findPrevious` moves to the previous search result. Wraps around.
   */
  public async findPrevious(): Promise<void> {
    if (this.searchResults.length === 0) return;
    this.searchCurrentIndex = (this.searchCurrentIndex - 1 + this.searchResults.length) % this.searchResults.length;
    await this.focusCell(this.searchResults[this.searchCurrentIndex]);
    this.worksheet.setSearchHighlights(this.searchResults, this.searchCurrentIndex);
    this.worksheet.renderOverlay();
  }

  /**
   * `clearFind` clears search state and highlights.
   */
  public clearFind(): void {
    this.searchResults = [];
    this.searchCurrentIndex = -1;
    this.worksheet.setSearchHighlights([], -1);
    this.worksheet.renderOverlay();
  }

  /**
   * `getSearchState` returns current search state for the UI.
   */
  public getSearchState(): { total: number; currentIndex: number } {
    return {
      total: this.searchResults.length,
      currentIndex: this.searchCurrentIndex,
    };
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
   * `setFormulaResolver` sets the resolver for cross-sheet formula lookup.
   * Used to build global dependency graph for cycle detection.
   */
  public setFormulaResolver(
    resolver: FormulaResolver,
    sheetName: string,
  ): void {
    if (this.sheet) {
      this.sheet.setFormulaResolver(resolver, sheetName);
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
