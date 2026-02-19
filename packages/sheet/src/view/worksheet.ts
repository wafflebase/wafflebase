import { Range, Ref, Direction, FilterCondition } from '../model/types';
import { toColumnLabel, toSref } from '../model/coordinates';
import {
  extractFormulaRanges,
  isReferenceInsertPosition,
  findReferenceTokenAtCursor,
} from '../formula/formula';
import { DimensionIndex } from '../model/dimensions';
import { Sheet } from '../model/sheet';
import { Theme, getThemeColor } from './theme';
import { FormulaBar } from './formulabar';
import { CellInput } from './cellinput';
import { Overlay } from './overlay';
import { GridContainer } from './gridcontainer';
import { GridCanvas } from './gridcanvas';
import { ContextMenu } from './contextmenu';
import { FormulaAutocomplete, getAutocompleteContext } from './autocomplete';
import { FunctionBrowser } from './function-browser';
import { toTextRange, setTextRange } from './utils/textrange';
import { runKeyRules, isModPressed, keyEquals, matchesKeyCombo } from './keymap';
import {
  DefaultCellWidth,
  DefaultCellHeight,
  RowHeaderWidth,
  CellFontSize,
  CellLineHeight,
  CellPaddingY,
  BoundingRect,
  Position,
  Size,
  FreezeState,
  NoFreeze,
  FreezeHandleThickness,
  FreezeHandleHitArea,
  buildFreezeState,
  toBoundingRect,
  toBoundingRectWithFreeze,
  expandBoundingRect,
  toRef,
  toRefWithFreeze,
} from './layout';

const ResizeEdgeThreshold = 6;
const MinRowHeight = 10;
const MinColumnWidth = 20;
const AutoScrollDistanceForMaxSpeed = 120;
const AutoScrollMinSpeed = 300;
const AutoScrollMaxSpeed = 1800;
const AutofillHandleSize = 8;
const AutofillHandleHitPadding = 4;
const FilterPanelMaxVisibleValues = 200;
type FilterPanelMode = 'values' | 'condition';
type FilterPanelState = {
  col: number;
  values: string[];
  selected: Set<string>;
  initialSelected: Set<string>;
  search: string;
  mode: FilterPanelMode;
  condition: FilterCondition;
  initialCondition: FilterCondition;
  hasExistingCondition: boolean;
};
type EditorInputSource = 'formulaBar' | 'cellInput';
type MouseDragSessionConfig = {
  onMove: (e: MouseEvent) => void;
  onComplete?: () => void;
  onCleanup?: () => void;
};

/**
 * Worksheet represents the worksheet of the spreadsheet. It handles the
 * rendering of the grid, formula bar, and the overlay.
 */
export class Worksheet {
  private sheet?: Sheet;
  private theme: Theme;

  private container: HTMLDivElement;

  private formulaBar: FormulaBar;
  private cellInput: CellInput;
  private overlay: Overlay;
  private gridContainer: GridContainer;
  private gridCanvas: GridCanvas;
  private contextMenu: ContextMenu;
  private autocomplete: FormulaAutocomplete;
  private functionBrowser: FunctionBrowser;
  private resizeTooltip: HTMLDivElement;
  private filterPanel: HTMLDivElement;
  private filterPanelState: FilterPanelState | null = null;
  private filterPanelOutsideClickUnsub: (() => void) | null = null;
  private filterPanelKeyboardUnsub: (() => void) | null = null;

  private rowDim: DimensionIndex;
  private colDim: DimensionIndex;
  private hiddenRows: Set<number> = new Set();
  private hiddenRowSizeBackup: Map<number, number> = new Map();

  private listeners: Array<() => void> = [];
  private interactionCleanups: Set<() => void> = new Set();
  private resizeObserver: ResizeObserver;
  private preventDocumentSelectStart = (e: Event): void => {
    e.preventDefault();
  };

  private resizeHover: { axis: 'row' | 'column'; index: number } | null = null;
  private dragMove: {
    axis: 'row' | 'column';
    srcIndex: number;
    count: number;
    dropIndex: number;
  } | null = null;
  private editMode: boolean = false;
  private manuallyResizedRows: Set<number> = new Set();
  private formulaRanges: Array<Range> = [];
  private freezeState: FreezeState = NoFreeze;
  private freezeHandleHover: 'row' | 'column' | null = null;
  private filterButtonHoverCol: number | null = null;
  private freezeDrag: { axis: 'row' | 'column'; targetIndex: number } | null =
    null;
  private autofillPreview: Range | undefined;
  private onRenderCallback?: () => void;
  private readOnly: boolean;

  // Formula range selection state
  private formulaRangeAnchor: Ref | null = null;
  private activeFormulaInput: 'cellInput' | 'formulaBar' | null = null;
  private formulaRefInsertPos: { start: number; end: number } | null = null;
  private lastFormulaRefTarget: Ref | null = null;
  private nativeSelectionBlockDepth = 0;
  private previousBodyUserSelect = '';
  private previousBodyWebkitUserSelect = '';
  private pendingRenderFrame: number | null = null;
  private renderInFlight = false;
  private renderQueued = false;
  private renderVersion = 0;

  constructor(
    container: HTMLDivElement,
    theme: Theme = 'light',
    readOnly: boolean = false,
  ) {
    this.container = container;
    this.theme = theme;
    this.readOnly = readOnly;

    this.formulaBar = new FormulaBar(theme);
    this.gridContainer = new GridContainer(theme);
    this.overlay = new Overlay(theme);
    this.gridCanvas = new GridCanvas(theme);
    this.cellInput = new CellInput(theme);
    this.contextMenu = new ContextMenu(theme);
    this.autocomplete = new FormulaAutocomplete(theme);
    this.functionBrowser = new FunctionBrowser(theme);
    this.resizeTooltip = document.createElement('div');
    this.filterPanel = document.createElement('div');

    this.rowDim = new DimensionIndex(DefaultCellHeight);
    this.colDim = new DimensionIndex(DefaultCellWidth);

    this.gridContainer.appendChild(this.overlay.getContainer());
    this.gridContainer.appendChild(this.gridCanvas.getCanvas());
    this.gridContainer.appendChild(this.cellInput.getContainer());
    this.container.appendChild(this.formulaBar.getContainer());
    this.container.appendChild(this.gridContainer.getContainer());
    this.container.appendChild(this.contextMenu.getContainer());
    this.container.appendChild(this.autocomplete.getContainer());
    document.body.appendChild(this.functionBrowser.getContainer());
    this.resizeTooltip.style.position = 'fixed';
    this.resizeTooltip.style.display = 'none';
    this.resizeTooltip.style.pointerEvents = 'none';
    this.resizeTooltip.style.zIndex = '1001';
    this.resizeTooltip.style.padding = '4px 8px';
    this.resizeTooltip.style.borderRadius = '4px';
    this.resizeTooltip.style.border = `1px solid ${getThemeColor(theme, 'cellBorderColor')}`;
    this.resizeTooltip.style.backgroundColor = getThemeColor(theme, 'cellBGColor');
    this.resizeTooltip.style.color = getThemeColor(theme, 'cellTextColor');
    this.resizeTooltip.style.fontSize = '11px';
    this.resizeTooltip.style.fontFamily =
      '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    this.resizeTooltip.style.boxShadow = '0 2px 8px rgba(0, 0, 0, 0.15)';
    document.body.appendChild(this.resizeTooltip);

    this.filterPanel.style.position = 'fixed';
    this.filterPanel.style.display = 'none';
    this.filterPanel.style.zIndex = '1002';
    this.filterPanel.style.width = '260px';
    this.filterPanel.style.maxHeight = '360px';
    this.filterPanel.style.overflow = 'hidden';
    this.filterPanel.style.borderRadius = '6px';
    this.filterPanel.style.border = `1px solid ${getThemeColor(theme, 'cellBorderColor')}`;
    this.filterPanel.style.backgroundColor = getThemeColor(theme, 'cellBGColor');
    this.filterPanel.style.color = getThemeColor(theme, 'cellTextColor');
    this.filterPanel.style.fontSize = '12px';
    this.filterPanel.style.fontFamily =
      '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    this.filterPanel.style.boxShadow = '0 4px 14px rgba(0, 0, 0, 0.2)';
    document.body.appendChild(this.filterPanel);
    this.functionBrowser.setOnInsert((info) => {
      if (this.readOnly) {
        return;
      }
      void this.insertFunctionFromBrowser(info.name);
    });
    this.resizeObserver = new ResizeObserver(() => this.render());
  }

  public async initialize(sheet: Sheet) {
    this.sheet = sheet;
    this.sheet.setDimensions(this.rowDim, this.colDim);
    await this.sheet.loadDimensions();
    await this.sheet.loadStyles();
    await this.sheet.loadMerges();
    await this.sheet.loadFreezePane();
    await this.sheet.loadFilterState();
    this.hiddenRows.clear();
    this.hiddenRowSizeBackup.clear();
    this.syncHiddenRowsFromSheet();
    this.updateFreezeState();
    this.formulaBar.initialize(sheet);
    this.addEventListeners();
    this.resizeObserver.observe(this.container);
    this.render();
  }

  /**
   * `updateFreezeState` rebuilds the cached FreezeState from the Sheet model.
   */
  private updateFreezeState(): void {
    const { frozenRows, frozenCols } = this.sheet!.getFreezePane();
    this.freezeState = buildFreezeState(
      frozenRows,
      frozenCols,
      this.rowDim,
      this.colDim,
    );
  }

  /**
   * `setFreezePane` sets the freeze pane and re-renders.
   */
  public async setFreezePane(
    frozenRows: number,
    frozenCols: number,
  ): Promise<void> {
    await this.sheet!.setFreezePane(frozenRows, frozenCols);
    this.updateFreezeState();
    this.render();
  }

  /**
   * `reloadFreezePane` reloads freeze pane state from the store.
   */
  public async reloadFreezePane(): Promise<void> {
    await this.sheet!.loadFreezePane();
    this.updateFreezeState();
  }

  /**
   * `panBy` scrolls the viewport by logical pixel deltas.
   */
  public panBy(deltaX: number, deltaY: number): void {
    this.gridContainer.scrollBy(deltaX, deltaY);
  }

  /**
   * `handleMobileDoubleTap` enters edit mode from a mobile double-tap.
   */
  public handleMobileDoubleTap(clientX: number, clientY: number): void {
    const { x, y } = this.clampClientPointToViewport(clientX, clientY);
    this.handleDblClickAt(x, y);
  }

  public cleanup() {
    if (this.pendingRenderFrame !== null) {
      cancelAnimationFrame(this.pendingRenderFrame);
      this.pendingRenderFrame = null;
    }

    this.cancelActiveInteractions();
    this.removeAllEventListeners();
    this.forceEndNativeSelectionBlock();
    this.resizeObserver.disconnect();

    this.formulaBar.cleanup();
    this.cellInput.cleanup();
    this.overlay.cleanup();
    this.gridCanvas.cleanup();
    this.gridContainer.cleanup();
    this.contextMenu.cleanup();
    this.autocomplete.cleanup();
    this.functionBrowser.cleanup();
    this.resizeTooltip.remove();
    this.hideFilterPanel();
    this.filterPanel.remove();

    this.sheet = undefined;
    this.container.innerHTML = '';
  }

  private beginNativeSelectionBlock(): void {
    this.nativeSelectionBlockDepth += 1;
    if (this.nativeSelectionBlockDepth !== 1) {
      return;
    }

    const bodyStyle = document.body.style;
    this.previousBodyUserSelect = bodyStyle.userSelect;
    this.previousBodyWebkitUserSelect = bodyStyle.webkitUserSelect;
    bodyStyle.userSelect = 'none';
    bodyStyle.webkitUserSelect = 'none';
    document.addEventListener('selectstart', this.preventDocumentSelectStart);
  }

  private endNativeSelectionBlock(): void {
    if (this.nativeSelectionBlockDepth === 0) {
      return;
    }

    this.nativeSelectionBlockDepth -= 1;
    if (this.nativeSelectionBlockDepth > 0) {
      return;
    }

    const bodyStyle = document.body.style;
    bodyStyle.userSelect = this.previousBodyUserSelect;
    bodyStyle.webkitUserSelect = this.previousBodyWebkitUserSelect;
    document.removeEventListener(
      'selectstart',
      this.preventDocumentSelectStart,
    );
  }

  private forceEndNativeSelectionBlock(): void {
    if (this.nativeSelectionBlockDepth === 0) {
      return;
    }
    this.nativeSelectionBlockDepth = 1;
    this.endNativeSelectionBlock();
  }

  private showResizeTooltip(
    axis: 'row' | 'column',
    size: number,
    clientX: number,
    clientY: number,
    selectedCount: number,
  ): void {
    const dimension = axis === 'column' ? 'Width' : 'Height';
    const selectionLabel =
      selectedCount > 1
        ? ` (${selectedCount} ${axis === 'column' ? 'columns' : 'rows'})`
        : '';
    this.resizeTooltip.textContent = `${dimension}: ${Math.round(size)}px${selectionLabel}`;
    this.resizeTooltip.style.left = `${clientX + 12}px`;
    this.resizeTooltip.style.top = `${clientY + 12}px`;
    this.resizeTooltip.style.display = 'block';
  }

  private hideResizeTooltip(): void {
    this.resizeTooltip.style.display = 'none';
  }

  private bindEventListener<K extends keyof HTMLElementEventMap>(
    element: EventTarget,
    type: K,
    handler: (this: typeof element, ev: HTMLElementEventMap[K]) => any,
    options?: boolean | AddEventListenerOptions,
  ): () => void {
    element.addEventListener(type, handler as EventListener, options);
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      element.removeEventListener(type, handler as EventListener, options);
    };
  }

  private addEventListener<K extends keyof HTMLElementEventMap>(
    element: EventTarget,
    type: K,
    handler: (this: typeof element, ev: HTMLElementEventMap[K]) => any,
    options?: boolean | AddEventListenerOptions,
  ): () => void {
    const cleanup = this.bindEventListener(element, type, handler, options);
    this.listeners.push(cleanup);
    return cleanup;
  }

  private registerInteractionCleanup(cleanup: () => void): () => void {
    let active = true;
    const wrapped = () => {
      if (!active) return;
      active = false;
      this.interactionCleanups.delete(wrapped);
      cleanup();
    };
    this.interactionCleanups.add(wrapped);
    return wrapped;
  }

  private addInteractionEventListener<K extends keyof HTMLElementEventMap>(
    element: EventTarget,
    type: K,
    handler: (this: typeof element, ev: HTMLElementEventMap[K]) => any,
    options?: boolean | AddEventListenerOptions,
  ): () => void {
    const cleanup = this.bindEventListener(element, type, handler, options);
    return this.registerInteractionCleanup(cleanup);
  }

  private startMouseDragSession({
    onMove,
    onComplete,
    onCleanup,
  }: MouseDragSessionConfig): () => void {
    let stop = () => {};
    const onUp = () => {
      try {
        onComplete?.();
      } finally {
        stop();
      }
    };

    const removeMove = this.addInteractionEventListener(
      document,
      'mousemove',
      onMove,
    );
    const removeUp = this.addInteractionEventListener(document, 'mouseup', onUp);

    stop = this.registerInteractionCleanup(() => {
      removeMove();
      removeUp();
      onCleanup?.();
    });

    return stop;
  }

  private cancelActiveInteractions(): void {
    for (const cleanup of Array.from(this.interactionCleanups)) {
      cleanup();
    }
  }

  private removeAllEventListeners(): void {
    for (const cleanup of this.listeners) {
      cleanup();
    }
    this.listeners = [];
  }

  /**
   * `focusGrid` blurs formula bar and cell input, and clears any lingering
   * contentEditable selection so that grid keyboard events work immediately.
   */
  private focusGrid(): void {
    this.formulaBar.blur();
    this.cellInput.hide();
    this.autocomplete.hide();
    this.functionBrowser.hide();
    this.formulaRanges = [];
    this.resetFormulaRangeState();
    window.getSelection()?.removeAllRanges();
  }

  /**
   * `finishEditing` finishes the editing of the cell.
   */
  private async finishEditing() {
    this.autocomplete.hide();
    this.functionBrowser.hide();

    const activeCell = this.sheet!.getActiveCell();
    if (this.formulaBar.isFocused()) {
      await this.sheet!.setData(activeCell, this.formulaBar.getValue());
      this.formulaBar.blur();
      this.cellInput.hide();
    } else if (this.cellInput.isFocused()) {
      await this.sheet!.setData(activeCell, this.cellInput.getValue());
      this.cellInput.hide();
    } else {
      return;
    }

    this.formulaRanges = [];
    this.resetFormulaRangeState();
    await this.autoResizeRow(activeCell.r);
  }

  /**
   * `isExternalInput` returns true when the event target is an interactive
   * input element (input, textarea, select, or contentEditable) that lives
   * outside the sheet container. This lets us skip handling keyboard events
   * that belong to dialogs or other UI without blocking normal grid usage.
   */
  private isExternalInput(target: EventTarget | null): boolean {
    if (this.functionBrowser.contains(target)) return true;
    if (!(target instanceof Element)) return false;
    if (this.container.contains(target)) return false;

    const tag = target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
    if ((target as HTMLElement).isContentEditable) return true;

    return false;
  }

  private handleKeyDown(e: KeyboardEvent): void {
    if (this.functionBrowser.isVisible()) {
      if (e.key === 'Escape') {
        e.preventDefault();
        this.functionBrowser.hide();
      }
      return;
    }

    // Ignore key events originating from interactive elements outside the
    // sheet container (e.g. dialog inputs) so they can type normally.
    if (this.isExternalInput(e.target)) {
      return;
    }

    if (this.formulaBar.isFocused()) {
      void this.handleFormulaKeydown(e);
      return;
    } else if (this.cellInput.isFocused()) {
      void this.handleCellInputKeydown(e);
      return;
    }

    void this.handleGridKeydown(e);
  }

  private handleKeyUp(e: KeyboardEvent): void {
    if (this.functionBrowser.isVisible()) {
      return;
    }

    // Ignore key events originating from interactive elements outside the
    // sheet container (e.g. dialog inputs) so they can type normally.
    if (this.isExternalInput(e.target)) {
      return;
    }

    // Skip autocomplete update for arrow/navigation keys when autocomplete is
    // visible. The keydown handler already adjusted the selection index and
    // re-triggering updateAutocomplete here would reset selectedIndex to 0,
    // causing the flickering/jump-back behaviour.
    const isNavKey =
      e.key === 'ArrowDown' ||
      e.key === 'ArrowUp' ||
      e.key === 'Escape' ||
      e.key === 'Enter' ||
      e.key === 'Tab';
    const skipAutocomplete =
      isNavKey &&
      (this.autocomplete.isListVisible() || this.autocomplete.isHintVisible());

    let value: string | undefined;
    let activeInput: HTMLDivElement | undefined;
    if (this.formulaBar.isFocused()) {
      value = this.formulaBar.getValue();
      activeInput = this.formulaBar.getFormulaInput();
      this.cellInput.setValue(value);
    } else if (this.cellInput.isFocused()) {
      value = this.cellInput.getValue();
      activeInput = this.cellInput.getInput();
      this.formulaBar.setValue(value);
    }

    if (value !== undefined && value.startsWith('=')) {
      this.formulaRanges = extractFormulaRanges(value).map((r) => r.range);
      this.renderOverlay();
    } else if (value !== undefined) {
      this.formulaRanges = [];
      this.renderOverlay();
    }

    if (skipAutocomplete) {
      return;
    }

    if (activeInput && value !== undefined) {
      this.updateAutocomplete(value, activeInput);
    } else {
      this.autocomplete.hide();
    }
  }

  /**
   * `updateAutocomplete` reads the formula text and cursor position to
   * show or hide the autocomplete dropdown.
   */
  private updateAutocomplete(value: string, inputEl: HTMLDivElement): void {
    if (!value.startsWith('=')) {
      this.autocomplete.hide();
      return;
    }

    const textRange = toTextRange(inputEl);
    if (!textRange) {
      this.autocomplete.hide();
      return;
    }

    const cursorPos = textRange.end;
    const ctx = getAutocompleteContext(value, cursorPos);

    // Compute anchor position below the input element
    const rect = inputEl.getBoundingClientRect();
    const anchor = { left: rect.left, top: rect.bottom + 2 };

    if (ctx.type === 'function-name') {
      this.autocomplete.showList(ctx.prefix, anchor);
    } else if (ctx.type === 'argument') {
      this.autocomplete.showHint(ctx.funcName, ctx.argIndex, anchor);
    } else {
      this.autocomplete.hide();
    }
  }

  /**
   * `toggleFunctionBrowser` opens or closes the function browser dialog.
   */
  public toggleFunctionBrowser(): void {
    if (this.functionBrowser.isVisible()) {
      this.functionBrowser.hide();
      return;
    }

    this.autocomplete.hide();
    this.functionBrowser.show();
  }

  /**
   * `insertFunctionCompletion` replaces the typed prefix with the completed
   * function name and opening parenthesis, then updates both inputs.
   */
  private insertFunctionCompletion(
    funcName: string,
    inputEl: HTMLDivElement,
  ): void {
    const text = inputEl.innerText;
    const textRange = toTextRange(inputEl);
    if (!textRange) return;

    const cursorPos = textRange.end;
    const before = text.slice(0, cursorPos);

    // Find the prefix being typed (the partial function name)
    const prefixMatch = before.match(/([A-Za-z_]\w*)$/);
    if (!prefixMatch) return;

    const prefixStart = cursorPos - prefixMatch[1].length;
    const after = text.slice(cursorPos);
    const newText = text.slice(0, prefixStart) + funcName + '(' + after;

    // Update both inputs
    this.formulaBar.setValue(newText);
    this.cellInput.setValue(newText);

    // Set cursor position after the opening parenthesis
    const newCursorPos = prefixStart + funcName.length + 1;
    setTextRange(inputEl, { start: newCursorPos, end: newCursorPos });

    this.autocomplete.hide();

    // Trigger autocomplete update for the new context (now inside function args)
    this.updateAutocomplete(newText, inputEl);
  }

  /**
   * `insertFunctionFromBrowser` inserts a function call at the current cursor.
   * If the current value is not a formula, it starts a new formula expression.
   */
  private async insertFunctionFromBrowser(funcName: string): Promise<void> {
    const inputEl = await this.getInputForFunctionInsert();
    const text = inputEl.innerText;
    const textRange = toTextRange(inputEl);

    let newText: string;
    let newCursorPos: number;

    if (!text.startsWith('=')) {
      newText = `=${funcName}(`;
      newCursorPos = newText.length;
    } else {
      const start = textRange?.start ?? text.length;
      const end = textRange?.end ?? text.length;
      newText = text.slice(0, start) + funcName + '(' + text.slice(end);
      newCursorPos = start + funcName.length + 1;
    }

    this.formulaBar.setValue(newText);
    this.cellInput.setValue(newText);
    setTextRange(inputEl, { start: newCursorPos, end: newCursorPos });
    inputEl.focus();

    this.formulaRanges = extractFormulaRanges(newText).map((r) => r.range);
    this.renderOverlay();
    this.autocomplete.hide();
    this.updateAutocomplete(newText, inputEl);
  }

  /**
   * `getInputForFunctionInsert` returns the target editor for function insert.
   * Function browser insertion always edits/focuses the in-cell editor.
   */
  private async getInputForFunctionInsert(): Promise<HTMLDivElement> {
    if (this.cellInput.isFocused()) {
      return this.cellInput.getInput();
    }

    const cellInput = this.cellInput.getInput();
    const formulaInput = this.formulaBar.getFormulaInput();
    const formulaText = formulaInput.innerText;
    const formulaRange = toTextRange(formulaInput);

    if (!this.cellInput.isShown()) {
      await this.showCellInput(true, true);
    }

    this.cellInput.setValue(formulaText);

    const cursorPos = formulaRange?.end ?? formulaText.length;
    setTextRange(cellInput, { start: cursorPos, end: cursorPos });
    if (!this.cellInput.isFocused()) {
      cellInput.focus();
    }

    return cellInput;
  }

  /**
   * `isInFormulaRangeMode` returns true when an input is focused with a formula
   * and the cursor is at a position where a cell reference can be inserted.
   */
  private isInFormulaRangeMode(): boolean {
    let value: string | undefined;
    let inputEl: HTMLDivElement | undefined;

    if (this.cellInput.isFocused()) {
      value = this.cellInput.getValue();
      inputEl = this.cellInput.getInput();
    } else if (this.formulaBar.isFocused()) {
      value = this.formulaBar.getValue();
      inputEl = this.formulaBar.getFormulaInput();
    }

    if (!value || !inputEl || !value.startsWith('=')) return false;

    const textRange = toTextRange(inputEl);
    if (!textRange) return false;

    return isReferenceInsertPosition(value, textRange.end);
  }

  /**
   * `insertReferenceAtCursor` inserts or replaces a cell reference in the
   * active formula input at the current cursor position.
   */
  private insertReferenceAtCursor(startRef: Ref, endRef?: Ref): void {
    const isCellInput = this.cellInput.isFocused();
    const isFormulaBarInput = this.formulaBar.isFocused();
    if (!isCellInput && !isFormulaBarInput) return;

    const inputEl = isCellInput
      ? this.cellInput.getInput()
      : this.formulaBar.getFormulaInput();
    const text = inputEl.innerText;
    const textRange = toTextRange(inputEl);
    if (!textRange) return;

    // Build the reference string
    const refStr =
      endRef && (startRef.r !== endRef.r || startRef.c !== endRef.c)
        ? toSref(startRef) + ':' + toSref(endRef)
        : toSref(startRef);

    let newText: string;
    let newCursorPos: number;

    if (this.formulaRefInsertPos) {
      // Drag update: replace the previously inserted span
      const { start, end } = this.formulaRefInsertPos;
      newText = text.slice(0, start) + refStr + text.slice(end);
      newCursorPos = start + refStr.length;
      this.formulaRefInsertPos = { start, end: newCursorPos };
    } else {
      const existingRef = findReferenceTokenAtCursor(text, textRange.end);
      if (existingRef) {
        // Replace existing reference at cursor
        newText =
          text.slice(0, existingRef.start) +
          refStr +
          text.slice(existingRef.end);
        newCursorPos = existingRef.start + refStr.length;
        this.formulaRefInsertPos = {
          start: existingRef.start,
          end: newCursorPos,
        };
      } else if (textRange.start !== textRange.end) {
        // Replace selection
        newText =
          text.slice(0, textRange.start) + refStr + text.slice(textRange.end);
        newCursorPos = textRange.start + refStr.length;
        this.formulaRefInsertPos = {
          start: textRange.start,
          end: newCursorPos,
        };
      } else {
        // Insert at cursor
        newText =
          text.slice(0, textRange.end) + refStr + text.slice(textRange.end);
        newCursorPos = textRange.end + refStr.length;
        this.formulaRefInsertPos = {
          start: textRange.end,
          end: newCursorPos,
        };
      }
    }

    // Update both inputs
    this.formulaBar.setValue(newText);
    this.cellInput.setValue(newText);

    // Restore cursor in the active input
    setTextRange(inputEl, { start: newCursorPos, end: newCursorPos });

    // Update formula ranges overlay
    if (newText.startsWith('=')) {
      this.formulaRanges = extractFormulaRanges(newText).map((r) => r.range);
      this.renderOverlay();
    }

    // Track last reference target for arrow key navigation
    this.lastFormulaRefTarget = endRef || startRef;
  }

  /**
   * `toggleAbsoluteReference` cycles the reference at the cursor through
   * absolute reference modes: A1 -> $A$1 -> A$1 -> $A1 -> A1
   */
  private toggleAbsoluteReference(inputEl: HTMLDivElement): void {
    const text = inputEl.innerText;
    if (!text.startsWith('=')) return;

    const textRange = toTextRange(inputEl);
    if (!textRange) return;

    const ref = findReferenceTokenAtCursor(text, textRange.end);
    if (!ref) return;

    const refText = ref.text;

    // Parse current $ state
    const hasColDollar = refText.startsWith('$');
    const inner = refText.replace(/\$/g, '');
    // Find where the row number starts in the clean reference
    let rowStart = 0;
    for (let i = 0; i < inner.length; i++) {
      if (inner.charCodeAt(i) >= 48 && inner.charCodeAt(i) <= 57) {
        rowStart = i;
        break;
      }
    }
    const colPart = inner.slice(0, rowStart);
    const rowPart = inner.slice(rowStart);

    // Detect if row part had $ by checking the character before the row digits
    const rowDigitIdx = refText.indexOf(
      rowPart,
      refText.lastIndexOf(colPart) + colPart.length,
    );
    const hasRowDollar = rowDigitIdx > 0 && refText[rowDigitIdx - 1] === '$';

    // Cycle: A1 -> $A$1 -> A$1 -> $A1 -> A1
    let newRef: string;
    if (!hasColDollar && !hasRowDollar) {
      // A1 -> $A$1
      newRef = '$' + colPart + '$' + rowPart;
    } else if (hasColDollar && hasRowDollar) {
      // $A$1 -> A$1
      newRef = colPart + '$' + rowPart;
    } else if (!hasColDollar && hasRowDollar) {
      // A$1 -> $A1
      newRef = '$' + colPart + rowPart;
    } else {
      // $A1 -> A1
      newRef = colPart + rowPart;
    }

    const newText = text.slice(0, ref.start) + newRef + text.slice(ref.end);
    const newCursorPos = ref.start + newRef.length;

    this.formulaBar.setValue(newText);
    this.cellInput.setValue(newText);
    setTextRange(inputEl, { start: newCursorPos, end: newCursorPos });

    if (newText.startsWith('=')) {
      this.formulaRanges = extractFormulaRanges(newText).map((r) => r.range);
      this.renderOverlay();
    }
  }

  /**
   * `resetFormulaRangeState` clears all formula range selection state.
   */
  private resetFormulaRangeState(): void {
    this.formulaRangeAnchor = null;
    this.activeFormulaInput = null;
    this.formulaRefInsertPos = null;
    this.lastFormulaRefTarget = null;
  }

  private handleDblClick(e: MouseEvent): void {
    e.preventDefault();
    this.handleDblClickAt(e.offsetX, e.offsetY);
  }

  private handleDblClickAt(x: number, y: number): void {
    if (this.readOnly) return;

    // Double-click on freeze handle → quick freeze top row / first column
    const freezeHandle = this.detectFreezeHandle(x, y);
    if (freezeHandle) {
      const currentFreeze = this.sheet!.getFreezePane();
      if (freezeHandle === 'row') {
        this.setFreezePane(
          currentFreeze.frozenRows > 0 ? 0 : 1,
          currentFreeze.frozenCols,
        );
      } else {
        this.setFreezePane(
          currentFreeze.frozenRows,
          currentFreeze.frozenCols > 0 ? 0 : 1,
        );
      }
      return;
    }

    const resizeEdge = this.detectResizeEdge(x, y);
    if (resizeEdge) {
      this.autoFitSize(resizeEdge.axis, resizeEdge.index);
      return;
    }

    this.showCellInput();
  }

  private handleContextMenu(e: MouseEvent): void {
    if (this.readOnly) return;

    const x = e.offsetX;
    const y = e.offsetY;

    const isRowHeader = x < RowHeaderWidth;
    const isColumnHeader = y < DefaultCellHeight;

    if (!isRowHeader && !isColumnHeader) {
      return;
    }

    e.preventDefault();

    if (isRowHeader) {
      const row = this.toRowFromMouse(y);
      if (row < 1) return;

      // Use multi-selection range if the right-clicked row is within the selection
      const selected = this.sheet!.getSelectedIndices();
      const useMulti =
        selected &&
        selected.axis === 'row' &&
        row >= selected.from &&
        row <= selected.to;
      const from = useMulti ? selected!.from : row;
      const count = useMulti ? selected!.to - selected!.from + 1 : 1;
      const rowLabel = count > 1 ? `${count} rows` : 'row';

      this.contextMenu.show(e.clientX, e.clientY, [
        {
          label: `Insert ${rowLabel} above`,
          action: () => {
            this.sheet!.insertRows(from, count).then(() => this.render());
          },
        },
        {
          label: `Insert ${rowLabel} below`,
          action: () => {
            this.sheet!.insertRows(from + count, count).then(() =>
              this.render(),
            );
          },
        },
        {
          label: `Delete ${rowLabel}`,
          action: () => {
            this.sheet!.deleteRows(from, count).then(() => this.render());
          },
        },
      ]);
    } else if (isColumnHeader) {
      const col = this.toColFromMouse(x);
      if (col < 1) return;

      // Use multi-selection range if the right-clicked column is within the selection
      const selected = this.sheet!.getSelectedIndices();
      const useMulti =
        selected &&
        selected.axis === 'column' &&
        col >= selected.from &&
        col <= selected.to;
      const from = useMulti ? selected!.from : col;
      const count = useMulti ? selected!.to - selected!.from + 1 : 1;
      const colLabel = count > 1 ? `${count} columns` : 'column';

      const items = [
        {
          label: `Insert ${colLabel} left`,
          action: () => {
            this.sheet!.insertColumns(from, count).then(() => this.render());
          },
        },
        {
          label: `Insert ${colLabel} right`,
          action: () => {
            this.sheet!.insertColumns(from + count, count).then(() =>
              this.render(),
            );
          },
        },
        {
          label: `Delete ${colLabel}`,
          action: () => {
            this.sheet!.deleteColumns(from, count).then(() => this.render());
          },
        },
      ];

      this.contextMenu.show(e.clientX, e.clientY, items);
    }
  }

  private getFilterButtonRect(
    col: number,
  ): { left: number; top: number; width: number; height: number } | null {
    const filterRange = this.sheet?.getFilterRange();
    if (!filterRange) {
      return null;
    }

    const headerRow = filterRange[0].r;
    const cellRect = this.getCellRect({ r: headerRow, c: col });
    if (cellRect.width <= 6 || cellRect.height <= 6) {
      return null;
    }

    const width = Math.min(16, Math.max(12, cellRect.width - 4));
    const height = Math.min(16, Math.max(12, cellRect.height - 6));
    return {
      left: cellRect.left + cellRect.width - width - 2,
      top: cellRect.top + Math.max(3, (cellRect.height - height) / 2),
      width,
      height,
    };
  }

  /**
   * `detectFilterButton` returns a column when the header filter indicator is clicked.
   */
  private detectFilterButton(x: number, y: number): number | null {
    if (!this.sheet || !this.sheet.hasFilter()) return null;
    if (x <= RowHeaderWidth || y <= DefaultCellHeight) return null;

    const filterRange = this.sheet.getFilterRange();
    if (!filterRange) return null;
    const ref = this.toRefFromMouse(x, y);
    if (ref.r !== filterRange[0].r) return null;
    if (!this.sheet.isColumnInFilter(ref.c)) return null;

    const rect = this.getFilterButtonRect(ref.c);
    if (!rect) return null;
    if (
      x < rect.left - 2 ||
      x > rect.left + rect.width + 2 ||
      y < rect.top - 2 ||
      y > rect.top + rect.height + 2
    ) {
      return null;
    }
    return ref.c;
  }

  /**
   * `showFilterPanel` opens a value-checklist dropdown for `col`.
   */
  private async showFilterPanel(
    col: number,
    preferredMode?: FilterPanelMode,
  ): Promise<void> {
    if (!this.sheet || !this.sheet.isColumnInFilter(col)) {
      return;
    }

    const payload = await this.sheet.getFilterColumnValues(col);
    if (!payload) {
      return;
    }

    const existing = this.sheet.getColumnFilterCondition(col);
    const isConditionMode =
      existing &&
      existing.op !== 'in' &&
      existing.op !== 'isEmpty' &&
      existing.op !== 'isNotEmpty';
    const mode: FilterPanelMode =
      preferredMode === 'condition' || isConditionMode ? 'condition' : 'values';

    const initialCondition: FilterCondition = existing
      ? {
          ...existing,
          values: existing.values ? [...existing.values] : undefined,
        }
      : { op: 'contains', value: '' };

    this.filterPanelState = {
      col,
      values: payload.values,
      selected: new Set(payload.selected),
      initialSelected: new Set(payload.selected),
      search: '',
      mode,
      condition: {
        ...initialCondition,
        values: initialCondition.values ? [...initialCondition.values] : undefined,
      },
      initialCondition,
      hasExistingCondition: !!existing,
    };
    this.renderFilterPanel();

    const buttonRect = this.getFilterButtonRect(col);
    if (!buttonRect) {
      return;
    }
    const viewport = this.viewport;
    const panelWidth = 260;
    const left = Math.min(
      viewport.left + Math.max(RowHeaderWidth, buttonRect.left - 6),
      viewport.left + Math.max(0, viewport.width - panelWidth - 4),
    );
    const top = viewport.top + buttonRect.top + buttonRect.height + 4;
    this.filterPanel.style.left = `${left}px`;
    this.filterPanel.style.top = `${top}px`;
    this.filterPanel.style.display = 'block';

    this.filterPanelKeyboardUnsub?.();
    const onKeyDown = (event: KeyboardEvent) => {
      if (!this.filterPanelState) {
        return;
      }
      const target = event.target as Node | null;
      const isInPanel = target ? this.filterPanel.contains(target) : false;

      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        this.hideFilterPanel();
        return;
      }
      if (event.key === 'Enter' && isInPanel) {
        event.preventDefault();
        event.stopPropagation();
        void this.applyFilterPanel();
      }
    };
    document.addEventListener('keydown', onKeyDown, true);
    this.filterPanelKeyboardUnsub = () => {
      document.removeEventListener('keydown', onKeyDown, true);
    };

    this.filterPanelOutsideClickUnsub?.();
    requestAnimationFrame(() => {
      if (!this.filterPanelState) {
        return;
      }
      const onMouseDown = (event: MouseEvent) => {
        if (!this.filterPanel.contains(event.target as Node)) {
          this.hideFilterPanel();
        }
      };
      document.addEventListener('mousedown', onMouseDown);
      this.filterPanelOutsideClickUnsub = () => {
        document.removeEventListener('mousedown', onMouseDown);
      };
    });
  }

  /**
   * `hideFilterPanel` closes the filter dropdown.
   */
  private hideFilterPanel(): void {
    this.filterPanel.style.display = 'none';
    this.filterPanel.innerHTML = '';
    this.filterPanelState = null;
    this.filterPanelOutsideClickUnsub?.();
    this.filterPanelOutsideClickUnsub = null;
    this.filterPanelKeyboardUnsub?.();
    this.filterPanelKeyboardUnsub = null;
  }

  private areStringSetsEqual(a: Set<string>, b: Set<string>): boolean {
    if (a.size !== b.size) {
      return false;
    }
    for (const value of a) {
      if (!b.has(value)) {
        return false;
      }
    }
    return true;
  }

  private areFilterConditionsEqual(
    left: FilterCondition,
    right: FilterCondition,
  ): boolean {
    if (left.op !== right.op) {
      return false;
    }

    if (left.op === 'in') {
      const leftValues = Array.from(new Set(left.values || [])).sort();
      const rightValues = Array.from(new Set(right.values || [])).sort();
      if (leftValues.length !== rightValues.length) {
        return false;
      }
      for (let i = 0; i < leftValues.length; i++) {
        if (leftValues[i] !== rightValues[i]) {
          return false;
        }
      }
      return true;
    }

    if (left.op === 'isEmpty' || left.op === 'isNotEmpty') {
      return true;
    }

    return (left.value || '').trim() === (right.value || '').trim();
  }

  private isFilterPanelDirty(state: FilterPanelState): boolean {
    if (state.mode === 'values') {
      return !this.areStringSetsEqual(state.selected, state.initialSelected);
    }
    return !this.areFilterConditionsEqual(state.condition, state.initialCondition);
  }

  private async applyFilterPanel(): Promise<void> {
    const state = this.filterPanelState;
    if (!state || !this.sheet) {
      return;
    }

    if (!this.isFilterPanelDirty(state)) {
      return;
    }

    if (state.mode === 'values') {
      await this.sheet.setColumnIncludedValues(state.col, Array.from(state.selected));
      this.hideFilterPanel();
      this.render();
      return;
    }

    await this.sheet.setColumnFilter(state.col, state.condition);
    this.hideFilterPanel();
    this.render();
  }

  private syncFilterPanelApplyButtonState(): void {
    const state = this.filterPanelState;
    if (!state) {
      return;
    }

    const apply = this.filterPanel.querySelector(
      'button[data-wb-filter-apply="true"]',
    ) as HTMLButtonElement | null;
    if (!apply) {
      return;
    }

    const enabled = this.isFilterPanelDirty(state);
    apply.disabled = !enabled;
    apply.style.opacity = enabled ? '1' : '0.5';
    apply.style.cursor = enabled ? 'pointer' : 'not-allowed';
  }

  private syncFilterPanelValuesSelectionState(filteredValues: string[]): void {
    const state = this.filterPanelState;
    if (!state) {
      return;
    }

    const summary = this.filterPanel.querySelector(
      '[data-wb-filter-summary="true"]',
    ) as HTMLDivElement | null;
    if (summary) {
      const selectedCount = state.values.filter((value) =>
        state.selected.has(value),
      ).length;
      summary.textContent = `Selected ${selectedCount} / ${state.values.length}`;
    }

    const selectAll = this.filterPanel.querySelector(
      'input[data-wb-filter-select-all="true"]',
    ) as HTMLInputElement | null;
    if (selectAll) {
      const selectedVisible = filteredValues.filter((value) =>
        state.selected.has(value),
      ).length;
      selectAll.checked =
        filteredValues.length > 0 && selectedVisible === filteredValues.length;
      selectAll.indeterminate =
        selectedVisible > 0 && selectedVisible < filteredValues.length;
    }

    this.syncFilterPanelApplyButtonState();
  }

  /**
   * `renderFilterPanel` renders the current dropdown state.
   */
  private renderFilterPanel(): void {
    const state = this.filterPanelState;
    if (!state) {
      return;
    }

    const activeElement = document.activeElement;
    const wasSearchFocused =
      activeElement instanceof HTMLInputElement &&
      activeElement.dataset.wbFilterSearch === 'true';
    const searchSelectionStart = wasSearchFocused
      ? activeElement.selectionStart
      : null;
    const searchSelectionEnd = wasSearchFocused
      ? activeElement.selectionEnd
      : null;

    const borderColor = getThemeColor(this.theme, 'cellBorderColor');
    const activeBG = getThemeColor(this.theme, 'selectionBGColor');

    const makeButton = (label: string): HTMLButtonElement => {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = label;
      button.style.height = '26px';
      button.style.padding = '0 8px';
      button.style.border = `1px solid ${borderColor}`;
      button.style.borderRadius = '4px';
      button.style.background = 'transparent';
      button.style.color = 'inherit';
      button.style.cursor = 'pointer';
      return button;
    };

    this.filterPanel.innerHTML = '';
    const root = document.createElement('div');
    root.style.display = 'flex';
    root.style.flexDirection = 'column';
    root.style.maxHeight = '360px';
    root.style.height = state.mode === 'values' ? '360px' : 'auto';
    root.style.overflow = 'hidden';

    const header = document.createElement('div');
    header.style.padding = '8px 10px';
    header.style.borderBottom = `1px solid ${borderColor}`;
    header.style.fontWeight = '600';
    header.textContent = `Filter ${toColumnLabel(state.col)}`;
    root.appendChild(header);

    const sortLabel = document.createElement('div');
    sortLabel.textContent = 'Sort';
    sortLabel.style.padding = '8px 10px 4px';
    sortLabel.style.fontSize = '11px';
    sortLabel.style.opacity = '0.7';
    root.appendChild(sortLabel);

    const sortRow = document.createElement('div');
    sortRow.style.display = 'flex';
    sortRow.style.flexWrap = 'wrap';
    sortRow.style.gap = '6px';
    sortRow.style.padding = '8px 10px 6px';

    const sortAsc = makeButton('Sort A to Z');
    sortAsc.onclick = () => {
      this.sheet!.sortFilterByColumn(state.col, 'asc').then((sorted) => {
        if (sorted) {
          this.hideFilterPanel();
          this.render();
        }
      });
    };
    const sortDesc = makeButton('Sort Z to A');
    sortDesc.onclick = () => {
      this.sheet!.sortFilterByColumn(state.col, 'desc').then((sorted) => {
        if (sorted) {
          this.hideFilterPanel();
          this.render();
        }
      });
    };
    sortRow.append(sortAsc, sortDesc);
    root.appendChild(sortRow);

    const modeLabel = document.createElement('div');
    modeLabel.textContent = 'Filter';
    modeLabel.style.padding = '0 10px 4px';
    modeLabel.style.fontSize = '11px';
    modeLabel.style.opacity = '0.7';
    root.appendChild(modeLabel);

    const modeRow = document.createElement('div');
    modeRow.style.display = 'flex';
    modeRow.style.flexWrap = 'wrap';
    modeRow.style.gap = '6px';
    modeRow.style.padding = '0 10px 8px';

    const makeModeButton = (label: string, mode: FilterPanelMode) => {
      const button = makeButton(label);
      if (state.mode === mode) {
        button.style.background = activeBG;
      }
      button.onclick = () => {
        if (!this.filterPanelState) return;
        this.filterPanelState.mode = mode;
        this.renderFilterPanel();
      };
      return button;
    };
    modeRow.append(
      makeModeButton('Filter by values', 'values'),
      makeModeButton('Filter by condition', 'condition'),
    );
    root.appendChild(modeRow);

    const body = document.createElement('div');
    body.style.flex = '1';
    body.style.minHeight = '0';
    body.style.padding = '0 10px';
    body.style.display = 'flex';
    body.style.flexDirection = 'column';
    root.appendChild(body);

    if (state.mode === 'values') {
      const search = document.createElement('input');
      search.type = 'text';
      search.dataset.wbFilterSearch = 'true';
      search.value = state.search;
      search.placeholder = 'Search values';
      search.style.width = '100%';
      search.style.margin = '0 0 8px';
      search.style.height = '28px';
      search.style.padding = '0 8px';
      search.style.border = `1px solid ${borderColor}`;
      search.style.borderRadius = '4px';
      search.style.background = 'transparent';
      search.style.color = 'inherit';
      search.oninput = () => {
        if (!this.filterPanelState) return;
        this.filterPanelState.search = search.value;
        this.renderFilterPanel();
      };
      body.appendChild(search);

      const allValues = state.values;
      const selectedCount = allValues.filter((value) =>
        state.selected.has(value),
      ).length;
      const summary = document.createElement('div');
      summary.dataset.wbFilterSummary = 'true';
      summary.textContent = `Selected ${selectedCount} / ${allValues.length}`;
      summary.style.margin = '0 0 8px';
      summary.style.fontSize = '11px';
      summary.style.opacity = '0.7';
      body.appendChild(summary);

      const keyword = state.search.trim().toLowerCase();
      const filteredValues = allValues
        .filter((value) => {
          if (!keyword) return true;
          const label = value === '' ? '(Blanks)' : value;
          return label.toLowerCase().includes(keyword);
        })
        .slice(0, FilterPanelMaxVisibleValues);

      const valuesWrap = document.createElement('div');
      valuesWrap.style.flex = '1';
      valuesWrap.style.minHeight = '0';
      valuesWrap.style.border = `1px solid ${borderColor}`;
      valuesWrap.style.borderRadius = '4px';
      valuesWrap.style.overflow = 'auto';

      const selectedVisible = filteredValues.filter((value) =>
        state.selected.has(value),
      ).length;
      const selectAllRow = document.createElement('label');
      selectAllRow.style.display = 'flex';
      selectAllRow.style.alignItems = 'center';
      selectAllRow.style.gap = '8px';
      selectAllRow.style.padding = '6px 8px';
      selectAllRow.style.borderBottom = `1px solid ${borderColor}`;
      selectAllRow.style.cursor = 'pointer';
      const selectAll = document.createElement('input');
      selectAll.type = 'checkbox';
      selectAll.dataset.wbFilterSelectAll = 'true';
      selectAll.checked =
        filteredValues.length > 0 && selectedVisible === filteredValues.length;
      selectAll.indeterminate =
        selectedVisible > 0 && selectedVisible < filteredValues.length;
      selectAll.onchange = () => {
        if (!this.filterPanelState) return;
        if (selectAll.checked) {
          for (const value of filteredValues) {
            this.filterPanelState.selected.add(value);
          }
        } else {
          for (const value of filteredValues) {
            this.filterPanelState.selected.delete(value);
          }
        }
        this.renderFilterPanel();
      };
      const selectAllText = document.createElement('span');
      selectAllText.textContent = 'Select all';
      selectAllRow.append(selectAll, selectAllText);
      valuesWrap.appendChild(selectAllRow);

      if (filteredValues.length === 0) {
        const empty = document.createElement('div');
        empty.style.padding = '10px';
        empty.style.opacity = '0.7';
        empty.textContent = 'No values';
        valuesWrap.appendChild(empty);
      } else {
        for (const value of filteredValues) {
          const row = document.createElement('label');
          row.style.display = 'flex';
          row.style.alignItems = 'center';
          row.style.gap = '8px';
          row.style.padding = '6px 8px';
          row.style.cursor = 'pointer';
          const checkbox = document.createElement('input');
          checkbox.type = 'checkbox';
          checkbox.checked = state.selected.has(value);
          checkbox.onchange = () => {
            if (!this.filterPanelState) return;
            if (checkbox.checked) {
              this.filterPanelState.selected.add(value);
            } else {
              this.filterPanelState.selected.delete(value);
            }
            this.syncFilterPanelValuesSelectionState(filteredValues);
          };
          const text = document.createElement('span');
          text.textContent = value === '' ? '(Blanks)' : value;
          text.style.overflow = 'hidden';
          text.style.textOverflow = 'ellipsis';
          text.style.whiteSpace = 'nowrap';
          row.append(checkbox, text);
          valuesWrap.appendChild(row);
        }
      }
      body.appendChild(valuesWrap);
    } else {
      const wrapper = document.createElement('div');
      wrapper.style.display = 'grid';
      wrapper.style.gap = '8px';

      const operator = document.createElement('select');
      operator.style.height = '30px';
      operator.style.border = `1px solid ${borderColor}`;
      operator.style.borderRadius = '4px';
      operator.style.background = 'transparent';
      operator.style.color = 'inherit';

      const conditionOptions: Array<{ value: FilterCondition['op']; label: string }> = [
        { value: 'contains', label: 'Contains' },
        { value: 'notContains', label: 'Does not contain' },
        { value: 'equals', label: 'Equals' },
        { value: 'notEquals', label: 'Does not equal' },
        { value: 'isEmpty', label: 'Is empty' },
        { value: 'isNotEmpty', label: 'Is not empty' },
      ];

      const currentOp =
        state.condition.op === 'in' ? 'contains' : state.condition.op;
      for (const item of conditionOptions) {
        const option = document.createElement('option');
        option.value = item.value;
        option.textContent = item.label;
        option.selected = currentOp === item.value;
        operator.appendChild(option);
      }
      operator.onchange = () => {
        if (!this.filterPanelState) return;
        const nextOp = operator.value as FilterCondition['op'];
        this.filterPanelState.condition = {
          op: nextOp,
          value: this.filterPanelState.condition.value || '',
        };
        this.renderFilterPanel();
      };
      wrapper.appendChild(operator);

      const needsValue =
        currentOp !== 'isEmpty' && currentOp !== 'isNotEmpty';
      if (needsValue) {
        const input = document.createElement('input');
        input.type = 'text';
        input.value = this.filterPanelState?.condition.value || '';
        input.placeholder = 'Enter value';
        input.style.height = '30px';
        input.style.padding = '0 8px';
        input.style.border = `1px solid ${borderColor}`;
        input.style.borderRadius = '4px';
        input.style.background = 'transparent';
        input.style.color = 'inherit';
        input.oninput = () => {
          if (!this.filterPanelState) return;
          this.filterPanelState.condition = {
            ...this.filterPanelState.condition,
            value: input.value,
          };
          this.syncFilterPanelApplyButtonState();
        };
        wrapper.appendChild(input);
      }

      body.appendChild(wrapper);
    }

    const footer = document.createElement('div');
    footer.style.display = 'flex';
    footer.style.justifyContent = 'flex-end';
    footer.style.gap = '6px';
    footer.style.padding = '8px 10px';

    const disableButton = (button: HTMLButtonElement): void => {
      button.disabled = true;
      button.style.opacity = '0.5';
      button.style.cursor = 'not-allowed';
    };

    const clear = makeButton('Clear');
    clear.onclick = () => {
      this.sheet!.clearColumnFilter(state.col).then(() => {
        this.hideFilterPanel();
        this.render();
      });
    };
    if (!state.hasExistingCondition) {
      disableButton(clear);
    }

    const cancel = makeButton('Cancel');
    cancel.onclick = () => this.hideFilterPanel();

    const apply = makeButton('Apply');
    apply.dataset.wbFilterApply = 'true';
    apply.onclick = () => {
      void this.applyFilterPanel();
    };
    if (!this.isFilterPanelDirty(state)) {
      disableButton(apply);
    }

    footer.append(clear, cancel, apply);
    root.appendChild(footer);

    this.filterPanel.appendChild(root);

    if (wasSearchFocused && state.mode === 'values') {
      const restoredSearch = this.filterPanel.querySelector(
        'input[data-wb-filter-search="true"]',
      ) as HTMLInputElement | null;
      if (restoredSearch) {
        restoredSearch.focus();
        const valueLength = restoredSearch.value.length;
        const start = Math.max(
          0,
          Math.min(valueLength, searchSelectionStart ?? valueLength),
        );
        const end = Math.max(
          start,
          Math.min(valueLength, searchSelectionEnd ?? start),
        );
        restoredSearch.setSelectionRange(start, end);
      }
    }
  }

  /**
   * `addEventLisnters` adds event listeners to the spreadsheet.
   */
  private addEventListeners() {
    const scrollContainer = this.gridContainer.getScrollContainer();
    this.addEventListener(window, 'resize', () => this.render());
    this.addEventListener(scrollContainer, 'scroll', () => {
      this.hideFilterPanel();
      this.render();
    });
    this.addEventListener(scrollContainer, 'mousedown', (e) => {
      void this.handleMouseDown(e);
    });
    this.addEventListener(scrollContainer, 'mousemove', (e) => {
      this.handleMouseMove(e);
    });
    this.addEventListener(scrollContainer, 'mouseleave', () => {
      this.handleScrollContainerMouseLeave();
    });
    this.addEventListener(scrollContainer, 'dblclick', (e) => {
      this.handleDblClick(e);
    });
    this.addEventListener(scrollContainer, 'contextmenu', (e) => {
      this.handleContextMenu(e);
    });

    this.addEventListener(document, 'keydown', (e) => {
      this.handleKeyDown(e);
    });
    this.addEventListener(document, 'keyup', (e) => {
      this.handleKeyUp(e);
    });
  }

  /**
   * `detectResizeEdge` checks if the mouse is near a header edge for resizing.
   * Returns the axis and index if near an edge, null otherwise.
   */
  private detectResizeEdge(
    x: number,
    y: number,
  ): { axis: 'row' | 'column'; index: number } | null {
    const scroll = this.scroll;
    const freeze = this.freezeState;

    // Check column header right edges
    if (y < DefaultCellHeight && x > RowHeaderWidth) {
      const inFrozenCols =
        freeze.frozenCols > 0 && x < RowHeaderWidth + freeze.frozenWidth;
      const absX = inFrozenCols
        ? x - RowHeaderWidth
        : x -
          RowHeaderWidth -
          freeze.frozenWidth +
          this.colDim.getOffset(freeze.frozenCols + 1) +
          scroll.left;
      // Find which column edge we're near
      const col = this.colDim.findIndex(absX);
      const colRight = this.colDim.getOffset(col) + this.colDim.getSize(col);
      if (Math.abs(absX - colRight) < ResizeEdgeThreshold) {
        return { axis: 'column', index: col };
      }
      // Also check previous column's right edge
      if (col > 1) {
        const prevRight =
          this.colDim.getOffset(col - 1) + this.colDim.getSize(col - 1);
        if (Math.abs(absX - prevRight) < ResizeEdgeThreshold) {
          return { axis: 'column', index: col - 1 };
        }
      }
    }

    // Check row header bottom edges
    if (x < RowHeaderWidth && y > DefaultCellHeight) {
      const inFrozenRows =
        freeze.frozenRows > 0 && y < DefaultCellHeight + freeze.frozenHeight;
      const absY = inFrozenRows
        ? y - DefaultCellHeight
        : y -
          DefaultCellHeight -
          freeze.frozenHeight +
          this.rowDim.getOffset(freeze.frozenRows + 1) +
          scroll.top;
      const row = this.rowDim.findIndex(absY);
      const rowBottom = this.rowDim.getOffset(row) + this.rowDim.getSize(row);
      if (Math.abs(absY - rowBottom) < ResizeEdgeThreshold) {
        return { axis: 'row', index: row };
      }
      if (row > 1) {
        const prevBottom =
          this.rowDim.getOffset(row - 1) + this.rowDim.getSize(row - 1);
        if (Math.abs(absY - prevBottom) < ResizeEdgeThreshold) {
          return { axis: 'row', index: row - 1 };
        }
      }
    }

    return null;
  }

  /**
   * `detectFreezeHandle` checks if the mouse is over a freeze drag handle.
   * Returns 'row' or 'column' if hovering a handle, null otherwise.
   */
  private detectFreezeHandle(x: number, y: number): 'row' | 'column' | null {
    const freeze = this.freezeState;
    const hasFrozen = freeze.frozenRows > 0 || freeze.frozenCols > 0;
    const t = FreezeHandleThickness;
    const pad = FreezeHandleHitArea;

    // Row handle — horizontal bar spanning row-header width
    const rowBarY =
      hasFrozen && freeze.frozenRows > 0
        ? DefaultCellHeight + freeze.frozenHeight - t / 2
        : DefaultCellHeight - t;

    if (
      x >= 0 &&
      x <= RowHeaderWidth &&
      y >= rowBarY - pad &&
      y <= rowBarY + t + pad
    ) {
      return 'row';
    }

    // Column handle — vertical bar spanning column-header height
    const colBarX =
      hasFrozen && freeze.frozenCols > 0
        ? RowHeaderWidth + freeze.frozenWidth - t / 2
        : RowHeaderWidth - t;

    if (
      x >= colBarX - pad &&
      x <= colBarX + t + pad &&
      y >= 0 &&
      y <= DefaultCellHeight
    ) {
      return 'column';
    }

    return null;
  }

  /**
   * `startFreezeDrag` begins a freeze handle drag operation.
   */
  private startFreezeDrag(
    axis: 'row' | 'column',
    startEvent: MouseEvent,
  ): void {
    const scrollContainer = this.gridContainer.getScrollContainer();
    scrollContainer.style.cursor = 'grabbing';

    const computeTarget = (e: MouseEvent): number => {
      const port = this.viewport;
      if (axis === 'row') {
        const moveY =
          e.target !== scrollContainer
            ? Math.max(0, Math.min(port.height, e.clientY - port.top))
            : e.offsetY;
        if (moveY <= DefaultCellHeight) return 0;
        const absY = moveY - DefaultCellHeight;
        const row = this.rowDim.findIndex(absY);
        // Snap to nearest row boundary
        const rowOffset = this.rowDim.getOffset(row);
        const rowMid = rowOffset + this.rowDim.getSize(row) / 2;
        return absY < rowMid ? Math.max(0, row - 1) : row;
      } else {
        const moveX =
          e.target !== scrollContainer
            ? Math.max(0, Math.min(port.width, e.clientX - port.left))
            : e.offsetX;
        if (moveX <= RowHeaderWidth) return 0;
        const absX = moveX - RowHeaderWidth;
        const col = this.colDim.findIndex(absX);
        // Snap to nearest column boundary
        const colOffset = this.colDim.getOffset(col);
        const colMid = colOffset + this.colDim.getSize(col) / 2;
        return absX < colMid ? Math.max(0, col - 1) : col;
      }
    };

    this.freezeDrag = { axis, targetIndex: computeTarget(startEvent) };
    this.renderOverlay();

    const onMove = (e: MouseEvent) => {
      const targetIndex = computeTarget(e);
      if (this.freezeDrag && this.freezeDrag.targetIndex !== targetIndex) {
        this.freezeDrag = { axis, targetIndex };
        this.renderOverlay();
      }
    };

    this.startMouseDragSession({
      onMove,
      onComplete: () => {
        const targetIndex = this.freezeDrag?.targetIndex ?? 0;
        const currentFreeze = this.sheet!.getFreezePane();
        if (axis === 'row') {
          this.setFreezePane(targetIndex, currentFreeze.frozenCols);
        } else {
          this.setFreezePane(currentFreeze.frozenRows, targetIndex);
        }
      },
      onCleanup: () => {
        scrollContainer.style.cursor = '';
        this.freezeDrag = null;
        this.freezeHandleHover = null;
        this.renderOverlay();
      },
    });
  }

  /**
   * `toRefFromMouse` converts mouse event coordinates to a cell Ref, accounting for freeze panes.
   */
  private toRefFromMouse(x: number, y: number): Ref {
    const freeze = this.freezeState;
    if (freeze.frozenRows > 0 || freeze.frozenCols > 0) {
      return toRefWithFreeze(
        x,
        y,
        this.scroll,
        this.rowDim,
        this.colDim,
        freeze,
      );
    }
    return toRef(
      x + this.scroll.left,
      y + this.scroll.top,
      this.rowDim,
      this.colDim,
    );
  }

  /**
   * `toRowFromMouse` converts mouse Y coordinate to a row index, accounting for freeze panes.
   */
  private toRowFromMouse(y: number): number {
    const freeze = this.freezeState;
    const inFrozenRows =
      freeze.frozenRows > 0 && y < DefaultCellHeight + freeze.frozenHeight;
    const absY = inFrozenRows
      ? y - DefaultCellHeight
      : y -
        DefaultCellHeight -
        freeze.frozenHeight +
        this.rowDim.getOffset(freeze.frozenRows + 1) +
        this.scroll.top;
    return this.rowDim.findIndex(absY);
  }

  /**
   * `toColFromMouse` converts mouse X coordinate to a column index, accounting for freeze panes.
   */
  private toColFromMouse(x: number): number {
    const freeze = this.freezeState;
    const inFrozenCols =
      freeze.frozenCols > 0 && x < RowHeaderWidth + freeze.frozenWidth;
    const absX = inFrozenCols
      ? x - RowHeaderWidth
      : x -
        RowHeaderWidth -
        freeze.frozenWidth +
        this.colDim.getOffset(freeze.frozenCols + 1) +
        this.scroll.left;
    return this.colDim.findIndex(absX);
  }

  /**
   * `getAutofillSelectionRect` returns the on-screen rect for the current
   * cell selection (or active cell when no explicit range exists).
   */
  private getAutofillSelectionRect(range?: Range): BoundingRect | undefined {
    if (!this.sheet || this.sheet.getSelectionType() !== 'cell') {
      return undefined;
    }

    const currentRange = range || this.sheet.getRangeOrActiveCell();
    const start = toBoundingRectWithFreeze(
      currentRange[0],
      this.scroll,
      this.rowDim,
      this.colDim,
      this.freezeState,
    );
    const end = toBoundingRectWithFreeze(
      currentRange[1],
      this.scroll,
      this.rowDim,
      this.colDim,
      this.freezeState,
    );
    const left = Math.min(start.left, end.left);
    const top = Math.min(start.top, end.top);
    const right = Math.max(start.left + start.width, end.left + end.width);
    const bottom = Math.max(start.top + start.height, end.top + end.height);
    return {
      left,
      top,
      width: right - left,
      height: bottom - top,
    };
  }

  /**
   * `detectAutofillHandle` returns true when the pointer is over the fill handle.
   */
  private detectAutofillHandle(x: number, y: number): boolean {
    if (this.readOnly) {
      return false;
    }
    if (!this.sheet || this.sheet.getSelectionType() !== 'cell') {
      return false;
    }

    const range = this.sheet.getRangeOrActiveCell();

    const rect = this.getAutofillSelectionRect(range);
    if (!rect) {
      return false;
    }
    if (this.isAutofillHandleHiddenByFreeze(range, rect)) {
      return false;
    }

    const handleLeft = rect.left + rect.width - AutofillHandleSize / 2;
    const handleTop = rect.top + rect.height - AutofillHandleSize / 2;
    return (
      x >= handleLeft - AutofillHandleHitPadding &&
      x <= handleLeft + AutofillHandleSize + AutofillHandleHitPadding &&
      y >= handleTop - AutofillHandleHitPadding &&
      y <= handleTop + AutofillHandleSize + AutofillHandleHitPadding
    );
  }

  private shouldShowAutofillHandle(): boolean {
    if (this.readOnly) return false;
    if (!this.sheet || this.sheet.getSelectionType() !== 'cell') return false;

    const range = this.sheet.getRangeOrActiveCell();
    const rect = this.getAutofillSelectionRect(range);
    if (!rect) return false;

    return !this.isAutofillHandleHiddenByFreeze(range, rect);
  }

  private isAutofillHandleHiddenByFreeze(
    range: Range,
    selectionRect: BoundingRect,
  ): boolean {
    const freeze = this.freezeState;
    if (freeze.frozenRows === 0 && freeze.frozenCols === 0) {
      return false;
    }

    const handleRow = Math.max(range[0].r, range[1].r);
    const handleCol = Math.max(range[0].c, range[1].c);
    const isScrollableQuadrantHandle =
      handleRow > freeze.frozenRows && handleCol > freeze.frozenCols;
    if (!isScrollableQuadrantHandle) {
      return false;
    }

    const handleLeft = selectionRect.left + selectionRect.width - AutofillHandleSize / 2;
    const handleTop = selectionRect.top + selectionRect.height - AutofillHandleSize / 2;
    const frozenBoundaryLeft = RowHeaderWidth + freeze.frozenWidth;
    const frozenBoundaryTop = DefaultCellHeight + freeze.frozenHeight;
    return handleLeft < frozenBoundaryLeft || handleTop < frozenBoundaryTop;
  }

  private clampClientPointToViewport(
    clientX: number,
    clientY: number,
  ): { x: number; y: number } {
    const port = this.viewport;
    return {
      x: Math.max(0, Math.min(port.width, clientX - port.left)),
      y: Math.max(0, Math.min(port.height, clientY - port.top)),
    };
  }

  private getAutoScrollSpeed(distanceOutside: number): number {
    const clamped = Math.min(
      AutoScrollDistanceForMaxSpeed,
      Math.max(0, distanceOutside),
    );
    const ratio = clamped / AutoScrollDistanceForMaxSpeed;
    return AutoScrollMinSpeed + (AutoScrollMaxSpeed - AutoScrollMinSpeed) * ratio;
  }

  private getAutoScrollVelocity(
    clientPosition: number,
    minPosition: number,
    maxPosition: number,
  ): number {
    if (clientPosition < minPosition) {
      return -this.getAutoScrollSpeed(minPosition - clientPosition);
    }
    if (clientPosition > maxPosition) {
      return this.getAutoScrollSpeed(clientPosition - maxPosition);
    }
    return 0;
  }

  private handleMouseMove(e: MouseEvent): void {
    const scrollContainer = this.gridContainer.getScrollContainer();

    // While dragging with the primary mouse button, suppress resize hover guides.
    if ((e.buttons & 1) === 1) {
      if (this.resizeHover) {
        this.resizeHover = null;
        this.renderOverlay();
      }
      return;
    }

    // Check freeze handle hover first (highest priority)
    const freezeHandle = this.detectFreezeHandle(e.offsetX, e.offsetY);
    if (freezeHandle !== this.freezeHandleHover) {
      this.freezeHandleHover = freezeHandle;
      this.render();
    }
    if (freezeHandle) {
      scrollContainer.style.cursor = 'grab';
      this.setFilterButtonHoverCol(null);
      if (this.resizeHover) {
        this.resizeHover = null;
        this.renderOverlay();
      }
      return;
    }

    const result = this.detectResizeEdge(e.offsetX, e.offsetY);
    const changed =
      result?.axis !== this.resizeHover?.axis ||
      result?.index !== this.resizeHover?.index;

    if (changed) {
      this.resizeHover = result;
    }

    if (result) {
      scrollContainer.style.cursor =
        result.axis === 'column' ? 'col-resize' : 'row-resize';
      this.setFilterButtonHoverCol(null);
    } else {
      if (this.detectAutofillHandle(e.offsetX, e.offsetY)) {
        scrollContainer.style.cursor = 'crosshair';
        this.setFilterButtonHoverCol(null);
        if (changed) {
          this.renderOverlay();
        }
        return;
      }

      // Check if hovering over a selected header → show grab cursor
      const x = e.offsetX;
      const y = e.offsetY;
      const filterButtonCol = this.detectFilterButton(x, y);
      if (filterButtonCol !== null) {
        scrollContainer.style.cursor = 'pointer';
        this.setFilterButtonHoverCol(filterButtonCol);
        if (changed) {
          this.renderOverlay();
        }
        return;
      }
      this.setFilterButtonHoverCol(null);
      const selected = this.sheet?.getSelectedIndices();

      if (selected) {
        const isOverSelectedHeader =
          selected.axis === 'column'
            ? y < DefaultCellHeight &&
              x > RowHeaderWidth &&
              (() => {
                const col = this.toColFromMouse(x);
                return col >= selected.from && col <= selected.to;
              })()
            : x < RowHeaderWidth &&
              y > DefaultCellHeight &&
              (() => {
                const row = this.toRowFromMouse(y);
                return row >= selected.from && row <= selected.to;
              })();

        scrollContainer.style.cursor = isOverSelectedHeader ? 'grab' : '';
      } else {
        scrollContainer.style.cursor = '';
      }
    }

    if (changed) {
      this.renderOverlay();
    }
  }

  private handleScrollContainerMouseLeave(): void {
    const scrollContainer = this.gridContainer.getScrollContainer();
    scrollContainer.style.cursor = '';

    const changed =
      this.filterButtonHoverCol !== null ||
      this.resizeHover !== null ||
      this.freezeHandleHover !== null;

    this.filterButtonHoverCol = null;
    this.resizeHover = null;
    this.freezeHandleHover = null;

    if (changed) {
      this.render();
    }
  }

  private setFilterButtonHoverCol(col: number | null): void {
    if (this.filterButtonHoverCol === col) {
      return;
    }
    this.filterButtonHoverCol = col;
    this.render();
  }

  private async handleMouseDown(e: MouseEvent) {
    // Check for freeze handle first (highest priority)
    const freezeHandle = this.detectFreezeHandle(e.offsetX, e.offsetY);
    if (freezeHandle && !this.readOnly) {
      e.preventDefault();
      this.startFreezeDrag(freezeHandle, e);
      return;
    }

    // Check for resize edge
    const resizeEdge = this.detectResizeEdge(e.offsetX, e.offsetY);
    if (resizeEdge && !this.readOnly) {
      e.preventDefault();
      this.startResize(resizeEdge.axis, resizeEdge.index, e);
      return;
    }

    const x = e.offsetX;
    const y = e.offsetY;

    const filterButtonCol = this.detectFilterButton(x, y);
    if (filterButtonCol !== null) {
      e.preventDefault();
      await this.finishEditing();
      await this.showFilterPanel(filterButtonCol);
      return;
    }

    // Handle corner button click (select all)
    const isCorner = x < RowHeaderWidth && y < DefaultCellHeight;
    if (isCorner) {
      e.preventDefault();
      await this.finishEditing();
      this.sheet!.selectAllCells();
      this.render();
      return;
    }

    const isColumnHeader = y < DefaultCellHeight && x > RowHeaderWidth;
    const isRowHeader = x < RowHeaderWidth && y > DefaultCellHeight;

    // Handle column header click
    if (isColumnHeader) {
      e.preventDefault();
      await this.finishEditing();
      const col = this.toColFromMouse(x);
      if (col < 1) return;

      // Shift+click extends column selection from active cell's column
      if (e.shiftKey) {
        this.sheet!.selectColumnRange(this.sheet!.getActiveCell().c, col);
        this.render();
        return;
      }

      // Check if clicking on already-selected column header → start drag-move
      const selected = this.sheet!.getSelectedIndices();
      if (
        !this.readOnly &&
        selected &&
        selected.axis === 'column' &&
        col >= selected.from &&
        col <= selected.to
      ) {
        this.startDragMove(
          'column',
          selected.from,
          selected.to - selected.from + 1,
          e,
        );
        return;
      }

      this.sheet!.selectColumn(col);
      this.render();

      const startCol = col;
      let endCol = col;
      let lastClientX = e.clientX;
      let frameId: number | null = null;
      let lastFrameTime: number | null = null;

      const updateSelection = () => {
        const { x } = this.clampClientPointToViewport(lastClientX, 0);
        const nextEndCol = this.toColFromMouse(x);
        if (nextEndCol >= 1 && nextEndCol !== endCol) {
          endCol = nextEndCol;
          this.sheet!.selectColumnRange(startCol, endCol);
        }
      };

      const stopAutoScroll = () => {
        if (frameId !== null) {
          cancelAnimationFrame(frameId);
          frameId = null;
        }
        lastFrameTime = null;
      };

      const stepAutoScroll = (now: number) => {
        const port = this.viewport;
        const velocityX = this.getAutoScrollVelocity(
          lastClientX,
          port.left,
          port.left + port.width,
        );
        if (velocityX === 0) {
          frameId = null;
          lastFrameTime = null;
          return;
        }

        const dt = Math.min(
          50,
          lastFrameTime === null ? 16 : now - lastFrameTime,
        );
        lastFrameTime = now;
        this.gridContainer.scrollBy((velocityX * dt) / 1000, 0);
        updateSelection();
        this.render();
        frameId = requestAnimationFrame(stepAutoScroll);
      };

      const startAutoScroll = () => {
        if (frameId === null) {
          frameId = requestAnimationFrame(stepAutoScroll);
        }
      };

      const onMove = (e: MouseEvent) => {
        lastClientX = e.clientX;
        updateSelection();
        this.render();

        const port = this.viewport;
        const velocityX = this.getAutoScrollVelocity(
          lastClientX,
          port.left,
          port.left + port.width,
        );
        if (velocityX === 0) {
          stopAutoScroll();
        } else {
          startAutoScroll();
        }
      };
      this.beginNativeSelectionBlock();
      this.startMouseDragSession({
        onMove,
        onCleanup: () => {
          stopAutoScroll();
          this.endNativeSelectionBlock();
        },
      });
      return;
    }

    // Handle row header click
    if (isRowHeader) {
      e.preventDefault();
      await this.finishEditing();
      const row = this.toRowFromMouse(y);
      if (row < 1) return;

      // Shift+click extends row selection from active cell's row
      if (e.shiftKey) {
        this.sheet!.selectRowRange(this.sheet!.getActiveCell().r, row);
        this.render();
        return;
      }

      // Check if clicking on already-selected row header → start drag-move
      const selected = this.sheet!.getSelectedIndices();
      if (
        !this.readOnly &&
        selected &&
        selected.axis === 'row' &&
        row >= selected.from &&
        row <= selected.to
      ) {
        this.startDragMove(
          'row',
          selected.from,
          selected.to - selected.from + 1,
          e,
        );
        return;
      }

      this.sheet!.selectRow(row);
      this.render();

      const startRow = row;
      let endRow = row;
      let lastClientY = e.clientY;
      let frameId: number | null = null;
      let lastFrameTime: number | null = null;

      const updateSelection = () => {
        const { y } = this.clampClientPointToViewport(0, lastClientY);
        const nextEndRow = this.toRowFromMouse(y);
        if (nextEndRow >= 1 && nextEndRow !== endRow) {
          endRow = nextEndRow;
          this.sheet!.selectRowRange(startRow, endRow);
        }
      };

      const stopAutoScroll = () => {
        if (frameId !== null) {
          cancelAnimationFrame(frameId);
          frameId = null;
        }
        lastFrameTime = null;
      };

      const stepAutoScroll = (now: number) => {
        const port = this.viewport;
        const velocityY = this.getAutoScrollVelocity(
          lastClientY,
          port.top,
          port.top + port.height,
        );
        if (velocityY === 0) {
          frameId = null;
          lastFrameTime = null;
          return;
        }

        const dt = Math.min(
          50,
          lastFrameTime === null ? 16 : now - lastFrameTime,
        );
        lastFrameTime = now;
        this.gridContainer.scrollBy(0, (velocityY * dt) / 1000);
        updateSelection();
        this.render();
        frameId = requestAnimationFrame(stepAutoScroll);
      };

      const startAutoScroll = () => {
        if (frameId === null) {
          frameId = requestAnimationFrame(stepAutoScroll);
        }
      };

      const onMove = (e: MouseEvent) => {
        lastClientY = e.clientY;
        updateSelection();
        this.render();

        const port = this.viewport;
        const velocityY = this.getAutoScrollVelocity(
          lastClientY,
          port.top,
          port.top + port.height,
        );
        if (velocityY === 0) {
          stopAutoScroll();
        } else {
          startAutoScroll();
        }
      };
      this.beginNativeSelectionBlock();
      this.startMouseDragSession({
        onMove,
        onCleanup: () => {
          stopAutoScroll();
          this.endNativeSelectionBlock();
        },
      });
      return;
    }

    // Formula range mode: clicking on grid inserts a cell reference
    if (this.isInFormulaRangeMode()) {
      e.preventDefault();
      const clickedRef = this.toRefFromMouse(e.offsetX, e.offsetY);
      this.activeFormulaInput = this.cellInput.isFocused()
        ? 'cellInput'
        : 'formulaBar';

      if (e.shiftKey && this.formulaRangeAnchor) {
        // Shift+click: extend the last reference to a range
        const startRef: Ref = {
          r: Math.min(this.formulaRangeAnchor.r, clickedRef.r),
          c: Math.min(this.formulaRangeAnchor.c, clickedRef.c),
        };
        const endRef: Ref = {
          r: Math.max(this.formulaRangeAnchor.r, clickedRef.r),
          c: Math.max(this.formulaRangeAnchor.c, clickedRef.c),
        };
        this.insertReferenceAtCursor(startRef, endRef);
      } else {
        // Normal click: insert a new single-cell reference
        this.formulaRangeAnchor = clickedRef;
        this.formulaRefInsertPos = null;
        this.insertReferenceAtCursor(clickedRef);
      }

      const scrollContainer = this.gridContainer.getScrollContainer();
      const onMove = (e: MouseEvent) => {
        const port = this.viewport;
        const moveX =
          e.target !== scrollContainer
            ? Math.max(0, Math.min(port.width, e.clientX - port.left))
            : e.offsetX;
        const moveY =
          e.target !== scrollContainer
            ? Math.max(0, Math.min(port.height, e.clientY - port.top))
            : e.offsetY;
        const endRef = this.toRefFromMouse(moveX, moveY);
        // Normalize range so start <= end
        const startRef: Ref = {
          r: Math.min(this.formulaRangeAnchor!.r, endRef.r),
          c: Math.min(this.formulaRangeAnchor!.c, endRef.c),
        };
        const rangeEnd: Ref = {
          r: Math.max(this.formulaRangeAnchor!.r, endRef.r),
          c: Math.max(this.formulaRangeAnchor!.c, endRef.c),
        };
        this.insertReferenceAtCursor(startRef, rangeEnd);
      };

      this.beginNativeSelectionBlock();
      this.startMouseDragSession({
        onMove,
        onComplete: () => {
          // Refocus the active input
          if (this.activeFormulaInput === 'cellInput') {
            this.cellInput.getInput().focus();
          } else if (this.activeFormulaInput === 'formulaBar') {
            this.formulaBar.getFormulaInput().focus();
          }
        },
        onCleanup: () => {
          this.endNativeSelectionBlock();
          this.formulaRefInsertPos = null;
        },
      });
      return;
    }

    if (this.detectAutofillHandle(e.offsetX, e.offsetY)) {
      e.preventDefault();
      await this.finishEditing();
      this.startAutofillDrag(e);
      return;
    }

    await this.finishEditing();

    // Shift+click extends selection from active cell to clicked cell
    if (e.shiftKey) {
      const ref = this.toRefFromMouse(e.offsetX, e.offsetY);
      this.sheet!.selectEnd(ref);
      this.render();
      return;
    }

    this.sheet!.selectStart(this.toRefFromMouse(e.offsetX, e.offsetY));
    this.render();

    let lastClientX = e.clientX;
    let lastClientY = e.clientY;
    let frameId: number | null = null;
    let lastFrameTime: number | null = null;

    const updateSelection = () => {
      const { x, y } = this.clampClientPointToViewport(lastClientX, lastClientY);
      this.sheet!.selectEnd(this.toRefFromMouse(x, y));
    };

    const stopAutoScroll = () => {
      if (frameId !== null) {
        cancelAnimationFrame(frameId);
        frameId = null;
      }
      lastFrameTime = null;
    };

    const stepAutoScroll = (now: number) => {
      const port = this.viewport;
      const velocityX = this.getAutoScrollVelocity(
        lastClientX,
        port.left,
        port.left + port.width,
      );
      const velocityY = this.getAutoScrollVelocity(
        lastClientY,
        port.top,
        port.top + port.height,
      );

      if (velocityX === 0 && velocityY === 0) {
        frameId = null;
        lastFrameTime = null;
        return;
      }

      const dt = Math.min(
        50,
        lastFrameTime === null ? 16 : now - lastFrameTime,
      );
      lastFrameTime = now;
      this.gridContainer.scrollBy((velocityX * dt) / 1000, (velocityY * dt) / 1000);
      updateSelection();
      this.render();
      frameId = requestAnimationFrame(stepAutoScroll);
    };

    const startAutoScroll = () => {
      if (frameId === null) {
        frameId = requestAnimationFrame(stepAutoScroll);
      }
    };

    const onMove = (e: MouseEvent) => {
      lastClientX = e.clientX;
      lastClientY = e.clientY;
      updateSelection();
      this.renderOverlay();

      const port = this.viewport;
      const velocityX = this.getAutoScrollVelocity(
        lastClientX,
        port.left,
        port.left + port.width,
      );
      const velocityY = this.getAutoScrollVelocity(
        lastClientY,
        port.top,
        port.top + port.height,
      );
      if (velocityX === 0 && velocityY === 0) {
        stopAutoScroll();
      } else {
        startAutoScroll();
      }
    };

    this.beginNativeSelectionBlock();
    this.startMouseDragSession({
      onMove,
      onComplete: () => {
        // Finalize drag selection with a full render so toolbar listeners
        // subscribed via onSelectionChange receive the updated range state.
        this.render();
      },
      onCleanup: () => {
        stopAutoScroll();
        this.endNativeSelectionBlock();
      },
    });
  }

  /**
   * `startAutofillDrag` begins drag-fill from the current selection handle.
   */
  private startAutofillDrag(startEvent: MouseEvent): void {
    let lastClientX = startEvent.clientX;
    let lastClientY = startEvent.clientY;
    let frameId: number | null = null;
    let lastFrameTime: number | null = null;

    const updatePreview = () => {
      const { x, y } = this.clampClientPointToViewport(lastClientX, lastClientY);
      const target = this.toRefFromMouse(x, y);
      this.autofillPreview = this.sheet!.getAutofillPreviewRange(target);
      this.renderOverlay();
    };

    const stopAutoScroll = () => {
      if (frameId !== null) {
        cancelAnimationFrame(frameId);
        frameId = null;
      }
      lastFrameTime = null;
    };

    const stepAutoScroll = (now: number) => {
      const port = this.viewport;
      const velocityX = this.getAutoScrollVelocity(
        lastClientX,
        port.left,
        port.left + port.width,
      );
      const velocityY = this.getAutoScrollVelocity(
        lastClientY,
        port.top,
        port.top + port.height,
      );

      if (velocityX === 0 && velocityY === 0) {
        frameId = null;
        lastFrameTime = null;
        return;
      }

      const dt = Math.min(
        50,
        lastFrameTime === null ? 16 : now - lastFrameTime,
      );
      lastFrameTime = now;
      this.gridContainer.scrollBy((velocityX * dt) / 1000, (velocityY * dt) / 1000);
      updatePreview();
      frameId = requestAnimationFrame(stepAutoScroll);
    };

    const startAutoScroll = () => {
      if (frameId === null) {
        frameId = requestAnimationFrame(stepAutoScroll);
      }
    };

    const onMove = (e: MouseEvent) => {
      lastClientX = e.clientX;
      lastClientY = e.clientY;
      updatePreview();

      const port = this.viewport;
      const velocityX = this.getAutoScrollVelocity(
        lastClientX,
        port.left,
        port.left + port.width,
      );
      const velocityY = this.getAutoScrollVelocity(
        lastClientY,
        port.top,
        port.top + port.height,
      );
      if (velocityX === 0 && velocityY === 0) {
        stopAutoScroll();
      } else {
        startAutoScroll();
      }
    };

    this.beginNativeSelectionBlock();
    updatePreview();
    this.startMouseDragSession({
      onMove,
      onComplete: () => {
        const { x, y } = this.clampClientPointToViewport(lastClientX, lastClientY);
        const target = this.toRefFromMouse(x, y);
        const sheet = this.sheet!;
        void (async () => {
          const changed = await sheet.autofill(target);
          this.autofillPreview = undefined;
          if (!this.sheet) return;
          if (changed) {
            this.render();
          } else {
            this.renderOverlay();
          }
        })();
      },
      onCleanup: () => {
        stopAutoScroll();
        this.endNativeSelectionBlock();
        this.autofillPreview = undefined;
        if (this.sheet) {
          this.renderOverlay();
        }
      },
    });
  }

  /**
   * `startResize` begins a header drag-to-resize operation.
   */
  private startResize(
    axis: 'row' | 'column',
    index: number,
    startEvent: MouseEvent,
  ): void {
    const startPos =
      axis === 'column' ? startEvent.clientX : startEvent.clientY;
    const startSize =
      axis === 'column'
        ? this.colDim.getSize(index)
        : this.rowDim.getSize(index);

    const scrollContainer = this.gridContainer.getScrollContainer();
    scrollContainer.style.cursor =
      axis === 'column' ? 'col-resize' : 'row-resize';

    const dim = axis === 'column' ? this.colDim : this.rowDim;

    // Determine if the resized index is part of a multi-selection
    const selected = this.sheet!.getSelectedIndices();
    const isMulti =
      selected &&
      selected.axis === axis &&
      index >= selected.from &&
      index <= selected.to;
    const indices = isMulti
      ? Array.from(
          { length: selected!.to - selected!.from + 1 },
          (_, i) => selected!.from + i,
        )
      : [index];
    const selectedCount = indices.length;
    let pendingSize = startSize;
    let frameId: number | null = null;

    this.beginNativeSelectionBlock();
    this.showResizeTooltip(
      axis,
      startSize,
      startEvent.clientX,
      startEvent.clientY,
      selectedCount,
    );

    const onMove = (e: MouseEvent) => {
      const currentPos = axis === 'column' ? e.clientX : e.clientY;
      const delta = currentPos - startPos;
      const minSize = axis === 'column' ? MinColumnWidth : MinRowHeight;
      pendingSize = Math.max(minSize, startSize + delta);

      if (frameId === null) {
        frameId = requestAnimationFrame(() => {
          frameId = null;
          // During drag, only resize the handle being dragged (single index)
          dim.setSize(index, pendingSize);
          this.render();
        });
      }
      this.showResizeTooltip(
        axis,
        pendingSize,
        e.clientX,
        e.clientY,
        selectedCount,
      );
    };

    this.startMouseDragSession({
      onMove,
      onComplete: () => {
        // On mouseup, apply the final size to all selected indices
        const finalSize = pendingSize;
        dim.setSize(index, finalSize);
        for (const idx of indices) {
          dim.setSize(idx, finalSize);
          if (axis === 'column') {
            this.sheet!.setColumnWidth(idx, finalSize);
          } else {
            this.manuallyResizedRows.add(idx);
            this.sheet!.setRowHeight(idx, finalSize);
          }
        }
        this.render();
      },
      onCleanup: () => {
        scrollContainer.style.cursor = '';
        this.hideResizeTooltip();
        this.endNativeSelectionBlock();
        if (frameId !== null) {
          cancelAnimationFrame(frameId);
          frameId = null;
        }
      },
    });
  }

  /**
   * `autoFitSize` auto-fits a column width or row height to its content.
   */
  private async autoFitSize(
    axis: 'row' | 'column',
    index: number,
  ): Promise<void> {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d')!;
    const padding = 6;

    if (axis === 'column') {
      ctx.font = `${CellFontSize}px Arial`;

      // Measure header label
      const headerLabel = toColumnLabel(index);
      let maxWidth = ctx.measureText(headerLabel).width + padding;

      // Measure cell content in the visible range
      const [start, end] = this.viewRange;
      const range: Range = [
        { r: start.r, c: index },
        { r: end.r, c: index },
      ];
      const grid = await this.sheet!.fetchGrid(range);
      for (const [, cell] of grid) {
        if (cell.v) {
          const w = ctx.measureText(cell.v).width + padding;
          if (w > maxWidth) maxWidth = w;
        }
      }

      const newWidth = Math.max(MinColumnWidth, Math.ceil(maxWidth));
      this.sheet!.setColumnWidth(index, newWidth);
    } else {
      // For rows, compute content-based height
      this.manuallyResizedRows.delete(index);
      const newHeight = await this.computeContentHeight(index);
      this.sheet!.setRowHeight(index, newHeight);
    }

    this.render();
  }

  /**
   * `computeContentHeight` measures the max number of lines across cells
   * in the given row (visible columns) and returns the appropriate height.
   */
  private async computeContentHeight(row: number): Promise<number> {
    const [start, end] = this.viewRange;
    const range: Range = [
      { r: row, c: start.c },
      { r: row, c: end.c },
    ];
    const grid = await this.sheet!.fetchGrid(range);

    let maxLines = 1;
    for (const [, cell] of grid) {
      if (cell.v) {
        const lines = cell.v.split('\n').length;
        if (lines > maxLines) maxLines = lines;
      }
    }

    if (maxLines <= 1) {
      return DefaultCellHeight;
    }

    return Math.max(
      DefaultCellHeight,
      Math.ceil(maxLines * CellFontSize * CellLineHeight + 2 * CellPaddingY),
    );
  }

  /**
   * `autoResizeRow` auto-resizes a row to fit its content, unless it
   * has been manually resized by the user.
   */
  private async autoResizeRow(row: number): Promise<void> {
    if (this.manuallyResizedRows.has(row)) return;

    const newHeight = await this.computeContentHeight(row);
    const currentHeight = this.rowDim.getSize(row);
    if (newHeight !== currentHeight) {
      this.sheet!.setRowHeight(row, newHeight);
      this.render();
    }
  }

  /**
   * `startDragMove` begins a drag-to-move operation for selected rows/columns.
   */
  private startDragMove(
    axis: 'row' | 'column',
    srcIndex: number,
    count: number,
    startEvent: MouseEvent,
  ): void {
    const scrollContainer = this.gridContainer.getScrollContainer();
    scrollContainer.style.cursor = 'grabbing';

    const dim = axis === 'column' ? this.colDim : this.rowDim;

    const computeDropIndex = (e: MouseEvent): number => {
      const port = this.viewport;
      if (axis === 'column') {
        const moveX =
          e.target !== scrollContainer
            ? Math.max(0, Math.min(port.width, e.clientX - port.left))
            : e.offsetX;
        const col = this.toColFromMouse(moveX);
        // Snap to nearest edge
        const freeze = this.freezeState;
        const inFrozenCols =
          freeze.frozenCols > 0 && moveX < RowHeaderWidth + freeze.frozenWidth;
        const absX = inFrozenCols
          ? moveX - RowHeaderWidth
          : moveX -
            RowHeaderWidth -
            freeze.frozenWidth +
            this.colDim.getOffset(freeze.frozenCols + 1) +
            this.scroll.left;
        const colOffset = dim.getOffset(col);
        const colMid = colOffset + dim.getSize(col) / 2;
        return absX < colMid ? col : col + 1;
      } else {
        const moveY =
          e.target !== scrollContainer
            ? Math.max(0, Math.min(port.height, e.clientY - port.top))
            : e.offsetY;
        const row = this.toRowFromMouse(moveY);
        const freeze = this.freezeState;
        const inFrozenRows =
          freeze.frozenRows > 0 &&
          moveY < DefaultCellHeight + freeze.frozenHeight;
        const absY = inFrozenRows
          ? moveY - DefaultCellHeight
          : moveY -
            DefaultCellHeight -
            freeze.frozenHeight +
            this.rowDim.getOffset(freeze.frozenRows + 1) +
            this.scroll.top;
        const rowOffset = dim.getOffset(row);
        const rowMid = rowOffset + dim.getSize(row) / 2;
        return absY < rowMid ? row : row + 1;
      }
    };

    this.dragMove = {
      axis,
      srcIndex,
      count,
      dropIndex: computeDropIndex(startEvent),
    };
    this.renderOverlay();

    const onMove = (e: MouseEvent) => {
      const dropIndex = computeDropIndex(e);
      if (this.dragMove && this.dragMove.dropIndex !== dropIndex) {
        this.dragMove = { axis, srcIndex, count, dropIndex };
        this.renderOverlay();
      }
    };

    this.startMouseDragSession({
      onMove,
      onComplete: () => {
        const dropIndex = this.dragMove?.dropIndex;
        if (
          dropIndex === undefined ||
          (dropIndex >= srcIndex && dropIndex <= srcIndex + count)
        ) {
          return;
        }

        const movePromise =
          axis === 'row'
            ? this.sheet!.moveRows(srcIndex, count, dropIndex)
            : this.sheet!.moveColumns(srcIndex, count, dropIndex);

        movePromise.then(() => {
          // Update selection to new position
          const newStart = dropIndex < srcIndex ? dropIndex : dropIndex - count;
          if (axis === 'row') {
            this.sheet!.selectRow(newStart);
            if (count > 1) {
              this.sheet!.selectRowRange(newStart, newStart + count - 1);
            }
          } else {
            this.sheet!.selectColumn(newStart);
            if (count > 1) {
              this.sheet!.selectColumnRange(newStart, newStart + count - 1);
            }
          }
          this.render();
        });
      },
      onCleanup: () => {
        scrollContainer.style.cursor = '';
        this.dragMove = null;
        this.renderOverlay();
      },
    });
  }

  /**
   * `handleFormulaInputKeydown` handles the keydown event for the formula input.
   */
  private async handleFormulaKeydown(e: KeyboardEvent) {
    await this.handleEditorKeydown(e, 'formulaBar');
  }

  /**
   * `handleCellInputKeydown` handles the keydown event for the cell input.
   */
  private async handleCellInputKeydown(e: KeyboardEvent) {
    await this.handleEditorKeydown(e, 'cellInput');
  }

  private async handleEditorKeydown(
    e: KeyboardEvent,
    source: EditorInputSource,
  ): Promise<void> {
    // Ignore keydown events during IME composition to prevent
    // duplicate characters (e.g. Korean input commit + Enter).
    if (e.isComposing) return;

    const inputEl =
      source === 'formulaBar'
        ? this.formulaBar.getFormulaInput()
        : this.cellInput.getInput();

    if (this.handleAutocompleteKeydown(e, inputEl)) {
      return;
    }

    const moveByArrow = (event: KeyboardEvent): void => {
      if (keyEquals(event, 'ArrowDown')) {
        this.sheet!.move('down');
      } else if (keyEquals(event, 'ArrowUp')) {
        this.sheet!.move('up');
      } else if (keyEquals(event, 'ArrowLeft')) {
        this.sheet!.move('left');
      } else if (keyEquals(event, 'ArrowRight')) {
        this.sheet!.move('right');
      }
    };

    const handled = await runKeyRules(e, [
      {
        match: (event) => matchesKeyCombo(event, { key: 'Enter', alt: true }),
        run: (event) => {
          event.preventDefault();
          document.execCommand('insertLineBreak');
        },
      },
      {
        match: (event) => keyEquals(event, 'Enter'),
        run: async (event) => {
          event.preventDefault();
          await this.finishEditing();

          if (source === 'formulaBar') {
            this.focusGrid();
            this.sheet!.move('down');
          } else {
            this.sheet!.moveInRange(event.shiftKey ? -1 : 1, 0);
          }
          this.render();
          this.scrollIntoView();
        },
      },
      {
        match: (event) => keyEquals(event, 'Tab'),
        run: async (event) => {
          event.preventDefault();
          await this.finishEditing();

          if (source === 'formulaBar') {
            this.focusGrid();
          }
          this.sheet!.moveInRange(0, event.shiftKey ? -1 : 1);
          this.render();
          this.scrollIntoView();
        },
      },
      {
        match: (event) =>
          this.isArrowKey(event) &&
          !this.editMode &&
          (source === 'formulaBar' || this.cellInput.hasFormula()) &&
          this.isInFormulaRangeMode(),
        run: (event) => {
          event.preventDefault();
          this.applyFormulaRangeArrowKey(event);
        },
      },
      {
        match: (event) =>
          source === 'cellInput' &&
          this.isArrowKey(event) &&
          !this.cellInput.hasFormula() &&
          !this.editMode,
        run: async (event) => {
          event.preventDefault();
          await this.finishEditing();
          moveByArrow(event);
          this.render();
          this.scrollIntoView();
        },
      },
      {
        match: (event) => keyEquals(event, 'F4'),
        run: (event) => {
          event.preventDefault();
          this.toggleAbsoluteReference(inputEl);
        },
      },
      {
        match: (event) => keyEquals(event, 'Escape'),
        run: (event) => {
          event.preventDefault();
          this.focusGrid();
          this.render();
        },
      },
    ]);
    if (!handled && source === 'formulaBar' && !this.cellInput.isShown()) {
      this.showCellInput(true, true);
    }
  }

  private handleAutocompleteKeydown(
    e: KeyboardEvent,
    inputEl: HTMLDivElement,
  ): boolean {
    if (this.autocomplete.isListVisible()) {
      if (keyEquals(e, 'ArrowDown')) {
        e.preventDefault();
        this.autocomplete.moveDown();
        return true;
      } else if (keyEquals(e, 'ArrowUp')) {
        e.preventDefault();
        this.autocomplete.moveUp();
        return true;
      } else if (keyEquals(e, 'Tab') || keyEquals(e, 'Enter')) {
        const selected = this.autocomplete.getSelectedFunction();
        if (selected) {
          e.preventDefault();
          this.insertFunctionCompletion(selected.name, inputEl);
          return true;
        }
      } else if (keyEquals(e, 'Escape')) {
        this.autocomplete.hide();
      }
    } else if (this.autocomplete.isHintVisible() && keyEquals(e, 'Escape')) {
      this.autocomplete.hide();
    }

    return false;
  }

  private isArrowKey(e: KeyboardEvent): boolean {
    return (
      keyEquals(e, 'ArrowDown') ||
      keyEquals(e, 'ArrowUp') ||
      keyEquals(e, 'ArrowLeft') ||
      keyEquals(e, 'ArrowRight')
    );
  }

  private applyFormulaRangeArrowKey(e: KeyboardEvent): void {
    // Arrow keys in formula range mode insert or expand references.
    const base = this.lastFormulaRefTarget || this.sheet!.getActiveCell();
    const targetRef = { ...base };
    if (keyEquals(e, 'ArrowDown')) targetRef.r = Math.max(1, targetRef.r + 1);
    else if (keyEquals(e, 'ArrowUp'))
      targetRef.r = Math.max(1, targetRef.r - 1);
    else if (keyEquals(e, 'ArrowLeft'))
      targetRef.c = Math.max(1, targetRef.c - 1);
    else if (keyEquals(e, 'ArrowRight')) targetRef.c = targetRef.c + 1;

    if (e.shiftKey && this.formulaRangeAnchor) {
      // Shift+Arrow: extend range from anchor to target
      const startRef: Ref = {
        r: Math.min(this.formulaRangeAnchor.r, targetRef.r),
        c: Math.min(this.formulaRangeAnchor.c, targetRef.c),
      };
      const endRef: Ref = {
        r: Math.max(this.formulaRangeAnchor.r, targetRef.r),
        c: Math.max(this.formulaRangeAnchor.c, targetRef.c),
      };
      this.insertReferenceAtCursor(startRef, endRef);
      // Track the moving end, not the normalized max corner.
      this.lastFormulaRefTarget = targetRef;
    } else {
      this.formulaRangeAnchor = targetRef;
      this.formulaRefInsertPos = null;
      this.insertReferenceAtCursor(targetRef);
    }
  }

  private async copy(): Promise<void> {
    const { text } = await this.sheet!.copy();
    await navigator.clipboard.writeText(text);
  }

  private async paste(): Promise<void> {
    try {
      let text: string | undefined;
      let html: string | undefined;

      // Try reading both text/html and text/plain from clipboard
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
          // Fall back to readText if read() is not permitted
          text = await navigator.clipboard.readText();
        }
      } else {
        text = await navigator.clipboard.readText();
      }

      await this.sheet!.paste({ text, html });
      this.sheet!.clearCopyBuffer();
      this.render();
    } catch (err) {
      console.error('Failed to paste cell content: ', err);
    }
  }

  /**
   * `handleGridKeydown` handles the keydown event for the grid.
   */
  private async handleGridKeydown(e: KeyboardEvent) {
    const move = async (event: KeyboardEvent, direction: Direction) => {
      event.preventDefault();

      const changed = event.shiftKey
        ? this.sheet!.resizeRange(direction)
        : isModPressed(event)
          ? await this.sheet!.moveToEdge(direction)
          : this.sheet!.move(direction);
      if (changed) {
        this.render();
        this.scrollIntoView();
      }
    };

    await runKeyRules(e, [
      {
        match: (event) => keyEquals(event, 'ArrowDown'),
        run: (event) => move(event, 'down'),
      },
      {
        match: (event) => keyEquals(event, 'ArrowUp'),
        run: (event) => move(event, 'up'),
      },
      {
        match: (event) => keyEquals(event, 'ArrowLeft'),
        run: (event) => move(event, 'left'),
      },
      {
        match: (event) => keyEquals(event, 'ArrowRight'),
        run: (event) => move(event, 'right'),
      },
      {
        match: (event) => matchesKeyCombo(event, { key: 'a', mod: true }),
        run: async (event) => {
          event.preventDefault();
          await this.sheet!.selectAll();
          this.render();
        },
      },
      {
        match: (event) => keyEquals(event, 'Tab'),
        run: (event) => {
          event.preventDefault();
          this.sheet!.moveInRange(0, event.shiftKey ? -1 : 1);
          this.render();
          this.scrollIntoView();
        },
      },
      {
        match: (event) => keyEquals(event, 'Enter'),
        run: (event) => {
          event.preventDefault();

          if (this.sheet!.hasRange()) {
            this.sheet!.moveInRange(event.shiftKey ? -1 : 1, 0);
            this.render();
            this.scrollIntoView();
          } else if (!this.readOnly) {
            this.showCellInput();
          }
        },
      },
      {
        match: (event) =>
          keyEquals(event, 'Delete') || keyEquals(event, 'Backspace'),
        run: async (event) => {
          if (this.readOnly) return;
          event.preventDefault();

          if (await this.sheet!.removeData()) {
            this.render();
          }
        },
      },
      {
        match: (event) =>
          !isModPressed(event) && this.isValidCellInput(event.key),
        run: () => {
          if (this.readOnly) return;
          this.showCellInput(true);
        },
      },
      {
        match: (event) =>
          matchesKeyCombo(event, { key: 'z', mod: true, shift: false }),
        run: async (event) => {
          if (this.readOnly) return;
          event.preventDefault();
          if (await this.sheet!.undo()) {
            this.render();
            this.scrollIntoView();
          }
        },
      },
      {
        match: (event) =>
          matchesKeyCombo(event, { key: 'z', mod: true, shift: true }) ||
          matchesKeyCombo(event, { key: 'y', mod: true }),
        run: async (event) => {
          if (this.readOnly) return;
          event.preventDefault();
          if (await this.sheet!.redo()) {
            this.render();
            this.scrollIntoView();
          }
        },
      },
      {
        match: (event) => keyEquals(event, 'Escape'),
        run: (event) => {
          event.preventDefault();
          if (this.sheet!.getCopyRange()) {
            this.sheet!.clearCopyBuffer();
            this.renderOverlay();
          }
        },
      },
      {
        match: (event) => matchesKeyCombo(event, { key: 'c', mod: true }),
        run: async (event) => {
          event.preventDefault();
          await this.copy();
        },
      },
      {
        match: (event) => matchesKeyCombo(event, { key: 'v', mod: true }),
        run: async (event) => {
          if (this.readOnly) return;
          event.preventDefault();
          await this.paste();
        },
      },
      {
        match: (event) => matchesKeyCombo(event, { key: 'b', mod: true }),
        run: async (event) => {
          if (this.readOnly) return;
          event.preventDefault();
          await this.sheet!.toggleRangeStyle('b');
          this.render();
        },
      },
      {
        match: (event) => matchesKeyCombo(event, { key: 'i', mod: true }),
        run: async (event) => {
          if (this.readOnly) return;
          event.preventDefault();
          await this.sheet!.toggleRangeStyle('i');
          this.render();
        },
      },
      {
        match: (event) => matchesKeyCombo(event, { key: 'u', mod: true }),
        run: async (event) => {
          if (this.readOnly) return;
          event.preventDefault();
          await this.sheet!.toggleRangeStyle('u');
          this.render();
        },
      },
      {
        match: (event) =>
          matchesKeyCombo(event, { key: 's', mod: true, shift: true }),
        run: async (event) => {
          if (this.readOnly) return;
          event.preventDefault();
          await this.sheet!.toggleRangeStyle('st');
          this.render();
        },
      },
      {
        match: (event) =>
          matchesKeyCombo(event, { key: 'm', mod: true, shift: true }),
        run: async (event) => {
          if (this.readOnly) return;
          event.preventDefault();
          if (await this.sheet!.toggleMergeSelection()) {
            this.render();
          }
        },
      },
    ]);
  }

  /**
   * `reloadDimensions` reloads dimension sizes from the store into the local
   * DimensionIndex objects. Call this when a remote change arrives.
   */
  public async reloadDimensions() {
    await this.sheet!.loadDimensions();
    await this.sheet!.loadStyles();
    await this.sheet!.loadMerges();
    await this.sheet!.loadFreezePane();
    await this.sheet!.loadFilterState();
    this.hiddenRows.clear();
    this.hiddenRowSizeBackup.clear();
    this.syncHiddenRowsFromSheet();
    this.updateFreezeState();
  }

  /**
   * `getGridViewportRect` returns the grid viewport rectangle relative to the
   * worksheet container.
   */
  public getGridViewportRect(): BoundingRect {
    const viewport = this.viewport;
    const container = this.container.getBoundingClientRect();
    return {
      left: viewport.left - container.left,
      top: viewport.top - container.top,
      width: viewport.width,
      height: viewport.height,
    };
  }

  /**
   * `getScrollableGridViewportRect` returns the unfrozen scrollable viewport
   * rectangle (Quadrant D), relative to the worksheet container.
   */
  public getScrollableGridViewportRect(): BoundingRect {
    const viewport = this.getGridViewportRect();
    const freeze = this.freezeState;
    const leftInset = RowHeaderWidth + freeze.frozenWidth;
    const topInset = DefaultCellHeight + freeze.frozenHeight;

    return {
      left: viewport.left + leftInset,
      top: viewport.top + topInset,
      width: Math.max(0, viewport.width - leftInset),
      height: Math.max(0, viewport.height - topInset),
    };
  }

  /**
   * `getCellRect` returns the on-screen rectangle for a cell in the current
   * viewport coordinate system.
   */
  public getCellRect(ref: Ref): BoundingRect {
    const freeze = this.freezeState;
    if (freeze.frozenRows > 0 || freeze.frozenCols > 0) {
      return toBoundingRectWithFreeze(
        ref,
        this.scroll,
        this.rowDim,
        this.colDim,
        freeze,
      );
    }
    return toBoundingRect(ref, this.scroll, this.rowDim, this.colDim);
  }

  /**
   * `getCellRectInScrollableViewport` returns the cell rectangle using
   * scrollable-quadrant coordinates (Quadrant D), even for refs in frozen
   * rows/columns. Useful for floating objects that should move with scroll.
   */
  public getCellRectInScrollableViewport(ref: Ref): BoundingRect {
    const freeze = this.freezeState;
    const scroll = this.scroll;
    const scrollableLeft =
      scroll.left + this.colDim.getOffset(freeze.frozenCols + 1) - freeze.frozenWidth;
    const scrollableTop =
      scroll.top + this.rowDim.getOffset(freeze.frozenRows + 1) - freeze.frozenHeight;
    return toBoundingRect(
      ref,
      { left: scrollableLeft, top: scrollableTop },
      this.rowDim,
      this.colDim,
    );
  }

  /**
   * `getRangeRect` returns the on-screen rectangle for the given range.
   */
  public getRangeRect(range: Range): BoundingRect {
    return expandBoundingRect(
      this.getCellRect(range[0]),
      this.getCellRect(range[1]),
    );
  }

  /**
   * `setOnRender` registers a callback that fires after every render.
   */
  public setOnRender(callback: () => void) {
    this.onRenderCallback = callback;
  }

  /**
   * `render` renders the spreadsheet in the container.
   */
  public render() {
    this.renderVersion += 1;
    this.requestRenderFrame();
  }

  private requestRenderFrame(): void {
    if (this.pendingRenderFrame !== null) {
      return;
    }

    this.pendingRenderFrame = requestAnimationFrame(() => {
      this.pendingRenderFrame = null;
      this.handleRenderFrame();
    });
  }

  private handleRenderFrame(): void {
    if (this.renderInFlight) {
      this.renderQueued = true;
      return;
    }

    this.renderInFlight = true;
    const targetVersion = this.renderVersion;
    void this.performRender(targetVersion).finally(() => {
      this.renderInFlight = false;
      if (this.renderQueued || this.renderVersion !== targetVersion) {
        this.renderQueued = false;
        this.requestRenderFrame();
      }
    });
  }

  private async performRender(targetVersion: number): Promise<void> {
    if (!this.sheet) {
      return;
    }

    this.formulaBar.render();

    await this.renderSheet(targetVersion);
    if (!this.sheet || targetVersion !== this.renderVersion) {
      return;
    }

    this.renderOverlay();
    this.onRenderCallback?.();
  }

  /**
   * `renderOverlay` renders the overlay on top of the sheet.
   */
  public renderOverlay() {
    this.overlay.render(
      this.viewport,
      this.scroll,
      this.sheet!.getActiveCell(),
      this.sheet!.getPresences(),
      this.sheet!.getRange(),
      this.rowDim,
      this.colDim,
      this.resizeHover,
      this.sheet!.getSelectionType(),
      this.dragMove
        ? { axis: this.dragMove.axis, dropIndex: this.dragMove.dropIndex }
        : null,
      this.formulaRanges,
      this.freezeState,
      this.freezeDrag,
      this.sheet!.getCopyRange(),
      this.autofillPreview,
      this.shouldShowAutofillHandle(),
      this.sheet!.getMerges(),
    );
  }

  /**
   * `viewRange` returns the visible range of the grid (unfrozen area / Quadrant D).
   * When freeze panes are active, scroll offsets are relative to the first unfrozen row/col.
   */
  private get viewRange(): Range {
    const scroll = this.scroll;
    const port = this.viewport;
    const freeze = this.freezeState;

    const unfrozenRowStart = this.rowDim.getOffset(freeze.frozenRows + 1);
    const unfrozenColStart = this.colDim.getOffset(freeze.frozenCols + 1);

    // Keep the scrolled viewport strictly in the unfrozen region.
    const startRow = Math.max(
      freeze.frozenRows + 1,
      this.rowDim.findIndex(unfrozenRowStart + scroll.top),
    );
    const endRow = Math.max(
      startRow,
      this.rowDim.findIndex(unfrozenRowStart + scroll.top + port.height) + 1,
    );
    const startCol = Math.max(
      freeze.frozenCols + 1,
      this.colDim.findIndex(unfrozenColStart + scroll.left),
    );
    const endCol = Math.max(
      startCol,
      this.colDim.findIndex(unfrozenColStart + scroll.left + port.width) + 1,
    );

    return [
      { r: startRow, c: startCol },
      { r: endRow, c: endCol },
    ];
  }

  /**
   * `scrollIntoView` scrolls the active cell into view, accounting for freeze panes.
   */
  private scrollIntoView(ref: Ref = this.sheet!.getActiveCell()) {
    const scroll = this.scroll;
    const freeze = this.freezeState;

    // If the cell is in the frozen region on an axis, no scroll needed on that axis
    const inFrozenRows = freeze.frozenRows > 0 && ref.r <= freeze.frozenRows;
    const inFrozenCols = freeze.frozenCols > 0 && ref.c <= freeze.frozenCols;

    // Cell absolute position (no scroll applied)
    const cell = toBoundingRect(
      ref,
      { left: 0, top: 0 },
      this.rowDim,
      this.colDim,
    );
    const mergeSpan = this.sheet!.getMerges().get(toSref(ref));
    if (mergeSpan) {
      const end = toBoundingRect(
        { r: ref.r + mergeSpan.rs - 1, c: ref.c + mergeSpan.cs - 1 },
        { left: 0, top: 0 },
        this.rowDim,
        this.colDim,
      );
      cell.width = end.left + end.width - cell.left;
      cell.height = end.top + end.height - cell.top;
    }

    // The unfrozen viewport area
    const unfrozenColStart = this.colDim.getOffset(freeze.frozenCols + 1);
    const unfrozenRowStart = this.rowDim.getOffset(freeze.frozenRows + 1);
    const availW = this.viewport.width - RowHeaderWidth - freeze.frozenWidth;
    const availH =
      this.viewport.height - DefaultCellHeight - freeze.frozenHeight;

    let changed = false;

    if (!inFrozenCols) {
      const visibleLeft = unfrozenColStart + scroll.left;
      const visibleRight = visibleLeft + availW;
      const cellLeft = cell.left - RowHeaderWidth; // absolute col offset
      const cellRight = cellLeft + cell.width;

      if (cellLeft < visibleLeft) {
        this.scroll = { left: cellLeft - unfrozenColStart };
        changed = true;
      } else if (cellRight > visibleRight) {
        this.scroll = { left: cellRight - availW - unfrozenColStart };
        changed = true;
      }
    }

    if (!inFrozenRows) {
      const visibleTop = unfrozenRowStart + scroll.top;
      const visibleBottom = visibleTop + availH;
      const cellTop = cell.top - DefaultCellHeight; // absolute row offset
      const cellBottom = cellTop + cell.height;

      if (cellTop < visibleTop) {
        this.scroll = { top: cellTop - unfrozenRowStart };
        changed = true;
      } else if (cellBottom > visibleBottom) {
        this.scroll = { top: cellBottom - availH - unfrozenRowStart };
        changed = true;
      }
    }

    if (changed) {
      this.render();
    }
  }

  /**
   * `showCellInput` shows the cell input.
   */
  private async showCellInput(
    withoutValue: boolean = false,
    withoutFocus: boolean = false,
  ) {
    if (!withoutFocus) {
      this.editMode = !withoutValue;
    }

    const cell = this.sheet!.getActiveCell();
    const freeze = this.freezeState;
    const rect =
      freeze.frozenRows > 0 || freeze.frozenCols > 0
        ? toBoundingRectWithFreeze(
            cell,
            this.scroll,
            this.rowDim,
            this.colDim,
            freeze,
          )
        : toBoundingRect(cell, this.scroll, this.rowDim, this.colDim);
    const mergeSpan = this.sheet!.getMerges().get(toSref(cell));
    if (mergeSpan) {
      const end =
        freeze.frozenRows > 0 || freeze.frozenCols > 0
          ? toBoundingRectWithFreeze(
              { r: cell.r + mergeSpan.rs - 1, c: cell.c + mergeSpan.cs - 1 },
              this.scroll,
              this.rowDim,
              this.colDim,
              freeze,
            )
          : toBoundingRect(
              { r: cell.r + mergeSpan.rs - 1, c: cell.c + mergeSpan.cs - 1 },
              this.scroll,
              this.rowDim,
              this.colDim,
            );
      rect.width = end.left + end.width - rect.left;
      rect.height = end.top + end.height - rect.top;
    }
    const value = withoutValue ? '' : await this.sheet!.toInputString(cell);
    const maxWidth = Math.max(rect.width, this.viewport.width - rect.left);
    const maxHeight = Math.max(rect.height, this.viewport.height - rect.top);
    this.cellInput.show(
      rect.left,
      rect.top,
      value,
      !withoutFocus,
      rect.width,
      rect.height,
      maxWidth,
      maxHeight,
    );

    const style = await this.sheet!.getStyle(cell);
    this.cellInput.applyStyle(style);

    if (value.startsWith('=')) {
      this.formulaRanges = extractFormulaRanges(value).map((r) => r.range);
      this.renderOverlay();
    }
  }

  /**
   * `isValidCellInput` checks if the key is a valid cell input.
   */
  private isValidCellInput(key: string): boolean {
    return key.length === 1 || key === 'Process';
  }

  /**
   * `renderSheet` renders the spreadsheet.
   */
  private async renderSheet(targetVersion: number = this.renderVersion) {
    const sheet = this.sheet;
    if (!sheet) {
      return;
    }

    this.syncHiddenRowsFromSheet();

    const gridSize = this.gridSize;
    const freeze = this.freezeState;

    // Scroll container represents only unfrozen content, but we must add
    // the frozen pixel size back so the user can scroll far enough to reveal
    // the last rows/columns that would otherwise be hidden behind the frozen area.
    this.gridContainer.updateDummySize(
      gridSize.width + RowHeaderWidth,
      gridSize.height + DefaultCellHeight,
    );

    const viewport = this.viewport;
    const scroll = this.scroll;

    // Fetch grid for all visible quadrants
    const viewRange = this.viewRange;
    const fullRange: Range = [
      // Frozen panes always need top-left data available.
      { r: 1, c: 1 },
      { r: viewRange[1].r, c: viewRange[1].c },
    ];
    const grid = await sheet.fetchGrid(fullRange);
    if (sheet !== this.sheet || targetVersion !== this.renderVersion) {
      return;
    }

    this.gridCanvas.render(
      viewport,
      scroll,
      viewRange,
      sheet.getActiveCell(),
      grid,
      this.rowDim,
      this.colDim,
      sheet.getSelectionType(),
      sheet.getRange(),
      freeze,
      this.freezeHandleHover,
      sheet.getColStyles(),
      sheet.getRowStyles(),
      sheet.getSheetStyle(),
      sheet.getRangeStyles(),
      sheet.getMerges(),
      sheet.getFilterRange(),
      sheet.getFilteredColumns(),
      this.filterButtonHoverCol,
    );
  }

  /**
   * `syncHiddenRowsFromSheet` applies filter-hidden rows as zero-height rows.
   */
  private syncHiddenRowsFromSheet(): void {
    const sheet = this.sheet;
    if (!sheet) return;

    const nextHiddenRows = sheet.getHiddenRows();

    for (const row of this.hiddenRows) {
      if (nextHiddenRows.has(row)) continue;
      const restoreSize =
        this.hiddenRowSizeBackup.get(row) ?? this.rowDim.getDefaultSize();
      this.rowDim.setSize(row, restoreSize);
      this.hiddenRowSizeBackup.delete(row);
    }

    for (const row of nextHiddenRows) {
      if (!this.hiddenRows.has(row)) {
        this.hiddenRowSizeBackup.set(row, this.rowDim.getSize(row));
        this.rowDim.setSize(row, 0);
      }
    }

    this.hiddenRows = nextHiddenRows;
  }

  private get gridSize(): Size {
    const dimension = this.sheet!.getDimension();
    return {
      width: this.colDim.getOffset(dimension.columns + 1),
      height: this.rowDim.getOffset(dimension.rows + 1),
    };
  }

  /**
   * `viewport` returns the viewport of the scroll container.
   * It returns the position and size of the scroll container.
   */
  private get viewport(): BoundingRect {
    return this.gridContainer.getViewport();
  }

  /**
   * `scroll` returns the scroll position of the scroll container.
   */
  private get scroll(): Position {
    return this.gridContainer.getScrollPosition();
  }

  /**
   * `scroll` sets the scroll position of the scroll container.
   */
  private set scroll(position: { left?: number; top?: number }) {
    this.gridContainer.setScrollPosition(position);
  }
}
