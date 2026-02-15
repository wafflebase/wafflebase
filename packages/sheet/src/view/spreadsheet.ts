import { CellStyle } from '../model/types';
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
   * `applyStyle` applies the given style to the current selection and re-renders.
   */
  public async applyStyle(style: Partial<CellStyle>) {
    if (!this.sheet || this._readOnly) return;
    await this.sheet.setRangeStyle(style);
    this.worksheet.render();
    this.notifySelectionChange();
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

  public cleanup() {
    this.worksheet.cleanup();
    this.selectionChangeCallbacks = [];
  }
}
