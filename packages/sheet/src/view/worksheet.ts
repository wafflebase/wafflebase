import { Range, Ref, Direction } from '../model/types';
import { toColumnLabel } from '../model/coordinates';
import { extractFormulaRanges } from '../formula/formula';
import { DimensionIndex } from '../model/dimensions';
import { Sheet } from '../model/sheet';
import { Theme } from './theme';
import { FormulaBar } from './formulabar';
import { CellInput } from './cellinput';
import { Overlay } from './overlay';
import { GridContainer } from './gridcontainer';
import { GridCanvas } from './gridcanvas';
import { ContextMenu } from './contextmenu';
import {
  DefaultCellWidth,
  DefaultCellHeight,
  RowHeaderWidth,
  ScrollIntervalMS,
  ScrollSpeedMS,
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
  toRef,
  toRefWithFreeze,
} from './layout';

const ResizeEdgeThreshold = 4;
const MinRowHeight = 10;
const MinColumnWidth = 20;

/**
 * Worksheet represents the worksheet of the spreadsheet. It handles the
 * rendering of the grid, formula bar, and the overlay.
 */
export class Worksheet {
  private sheet?: Sheet;

  private container: HTMLDivElement;

  private formulaBar: FormulaBar;
  private cellInput: CellInput;
  private overlay: Overlay;
  private gridContainer: GridContainer;
  private gridCanvas: GridCanvas;
  private contextMenu: ContextMenu;

  private rowDim: DimensionIndex;
  private colDim: DimensionIndex;

  private listeners: Array<{
    element: EventTarget;
    type: string;
    handler: EventListenerOrEventListenerObject;
  }> = [];
  private resizeObserver: ResizeObserver;

  private boundRender: () => void;
  private boundHandleGridKeydown: (e: KeyboardEvent) => void;
  private boundHandleFormulaKeydown: (e: KeyboardEvent) => void;
  private boundHandleCellInputKeydown: (e: KeyboardEvent) => void;
  private boundHandleMouseDown: (e: MouseEvent) => void;
  private boundHandleDblClick: (e: MouseEvent) => void;
  private boundHandleKeyDown: (e: KeyboardEvent) => void;
  private boundHandleKeyUp: () => void;
  private boundHandleMouseMove: (e: MouseEvent) => void;
  private boundHandleContextMenu: (e: MouseEvent) => void;

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
  private freezeDrag: { axis: 'row' | 'column'; targetIndex: number } | null =
    null;
  private onRenderCallback?: () => void;

  constructor(container: HTMLDivElement, theme: Theme = 'light') {
    this.container = container;

    this.formulaBar = new FormulaBar(theme);
    this.gridContainer = new GridContainer(theme);
    this.overlay = new Overlay(theme);
    this.gridCanvas = new GridCanvas(theme);
    this.cellInput = new CellInput(theme);
    this.contextMenu = new ContextMenu(theme);

    this.rowDim = new DimensionIndex(DefaultCellHeight);
    this.colDim = new DimensionIndex(DefaultCellWidth);

    this.gridContainer.appendChild(this.overlay.getContainer());
    this.gridContainer.appendChild(this.gridCanvas.getCanvas());
    this.gridContainer.appendChild(this.cellInput.getContainer());
    this.container.appendChild(this.formulaBar.getContainer());
    this.container.appendChild(this.gridContainer.getContainer());
    this.container.appendChild(this.contextMenu.getContainer());

    this.boundRender = this.render.bind(this);
    this.boundHandleGridKeydown = this.handleGridKeydown.bind(this);
    this.boundHandleFormulaKeydown = this.handleFormulaKeydown.bind(this);
    this.boundHandleCellInputKeydown = this.handleCellInputKeydown.bind(this);
    this.boundHandleMouseDown = this.handleMouseDown.bind(this);
    this.boundHandleDblClick = this.handleDblClick.bind(this);
    this.boundHandleKeyDown = this.handleKeyDown.bind(this);
    this.boundHandleKeyUp = this.handleKeyUp.bind(this);
    this.boundHandleMouseMove = this.handleMouseMove.bind(this);
    this.boundHandleContextMenu = this.handleContextMenu.bind(this);
    this.resizeObserver = new ResizeObserver(() => this.boundRender());
  }

  public async initialize(sheet: Sheet) {
    this.sheet = sheet;
    this.sheet.setDimensions(this.rowDim, this.colDim);
    await this.sheet.loadDimensions();
    await this.sheet.loadStyles();
    await this.sheet.loadFreezePane();
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

  public cleanup() {
    this.removeAllEventListeners();
    this.resizeObserver.disconnect();

    this.formulaBar.cleanup();
    this.cellInput.cleanup();
    this.overlay.cleanup();
    this.gridCanvas.cleanup();
    this.gridContainer.cleanup();
    this.contextMenu.cleanup();

    this.sheet = undefined;
    this.container.innerHTML = '';
  }

  private addEventListener<K extends keyof HTMLElementEventMap>(
    element: EventTarget,
    type: K,
    handler: (this: typeof element, ev: HTMLElementEventMap[K]) => any,
    options?: boolean | AddEventListenerOptions,
  ): void {
    element.addEventListener(type, handler as any, options);
    this.listeners.push({ element, type, handler: handler as any });
  }

  private removeAllEventListeners(): void {
    for (const { element, type, handler } of this.listeners) {
      element.removeEventListener(type, handler);
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
    this.formulaRanges = [];
    window.getSelection()?.removeAllRanges();
  }

  /**
   * `finishEditing` finishes the editing of the cell.
   */
  private async finishEditing() {
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
    await this.autoResizeRow(activeCell.r);
  }

  private handleKeyDown(e: KeyboardEvent): void {
    if (this.formulaBar.isFocused()) {
      this.boundHandleFormulaKeydown(e);
      return;
    } else if (this.cellInput.isFocused()) {
      this.boundHandleCellInputKeydown(e);
      return;
    }

    this.boundHandleGridKeydown(e);
  }

  private handleKeyUp(): void {
    let value: string | undefined;
    if (this.formulaBar.isFocused()) {
      value = this.formulaBar.getValue();
      this.cellInput.setValue(value);
    } else if (this.cellInput.isFocused()) {
      value = this.cellInput.getValue();
      this.formulaBar.setValue(value);
    }

    if (value !== undefined && value.startsWith('=')) {
      this.formulaRanges = extractFormulaRanges(value).map((r) => r.range);
      this.renderOverlay();
    } else if (value !== undefined) {
      this.formulaRanges = [];
      this.renderOverlay();
    }
  }

  private handleDblClick(e: MouseEvent): void {
    // Double-click on freeze handle → quick freeze top row / first column
    const freezeHandle = this.detectFreezeHandle(e.offsetX, e.offsetY);
    if (freezeHandle) {
      e.preventDefault();
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

    const resizeEdge = this.detectResizeEdge(e.offsetX, e.offsetY);
    if (resizeEdge) {
      e.preventDefault();
      this.autoFitSize(resizeEdge.axis, resizeEdge.index);
      return;
    }

    this.showCellInput();
    e.preventDefault();
  }

  private handleContextMenu(e: MouseEvent): void {
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

      this.contextMenu.show(e.clientX, e.clientY, [
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
      ]);
    }
  }

  /**
   * `addEventLisnters` adds event listeners to the spreadsheet.
   */
  private addEventListeners() {
    this.addEventListener(window, 'resize', this.boundRender);

    this.gridContainer.addEventListener('scroll', this.boundRender);
    this.gridContainer.addEventListener('mousedown', this.boundHandleMouseDown);
    this.gridContainer.addEventListener('mousemove', this.boundHandleMouseMove);
    this.gridContainer.addEventListener('dblclick', this.boundHandleDblClick);
    this.gridContainer.addEventListener(
      'contextmenu',
      this.boundHandleContextMenu,
    );

    this.addEventListener(document, 'keydown', this.boundHandleKeyDown);
    this.addEventListener(document, 'keyup', this.boundHandleKeyUp);
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

    const onUp = () => {
      scrollContainer.style.cursor = '';
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);

      const targetIndex = this.freezeDrag?.targetIndex ?? 0;
      this.freezeDrag = null;
      this.freezeHandleHover = null;

      const currentFreeze = this.sheet!.getFreezePane();
      if (axis === 'row') {
        this.setFreezePane(targetIndex, currentFreeze.frozenCols);
      } else {
        this.setFreezePane(currentFreeze.frozenRows, targetIndex);
      }
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
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

  private handleMouseMove(e: MouseEvent): void {
    const scrollContainer = this.gridContainer.getScrollContainer();

    // Check freeze handle hover first (highest priority)
    const freezeHandle = this.detectFreezeHandle(e.offsetX, e.offsetY);
    if (freezeHandle !== this.freezeHandleHover) {
      this.freezeHandleHover = freezeHandle;
      this.renderSheet();
    }
    if (freezeHandle) {
      scrollContainer.style.cursor = 'grab';
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
    } else {
      // Check if hovering over a selected header → show grab cursor
      const x = e.offsetX;
      const y = e.offsetY;
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

  private async handleMouseDown(e: MouseEvent) {
    // Check for freeze handle first (highest priority)
    const freezeHandle = this.detectFreezeHandle(e.offsetX, e.offsetY);
    if (freezeHandle) {
      e.preventDefault();
      this.startFreezeDrag(freezeHandle, e);
      return;
    }

    // Check for resize edge
    const resizeEdge = this.detectResizeEdge(e.offsetX, e.offsetY);
    if (resizeEdge) {
      e.preventDefault();
      this.startResize(resizeEdge.axis, resizeEdge.index, e);
      return;
    }

    const x = e.offsetX;
    const y = e.offsetY;

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
      const onMove = (e: MouseEvent) => {
        const port = this.viewport;
        const moveX =
          e.target !== this.gridContainer.getScrollContainer()
            ? Math.max(0, Math.min(port.width, e.clientX - port.left))
            : e.offsetX;
        const endCol = this.toColFromMouse(moveX);
        if (endCol >= 1) {
          this.sheet!.selectColumnRange(startCol, endCol);
          this.render();
        }
      };
      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
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
      const onMove = (e: MouseEvent) => {
        const port = this.viewport;
        const moveY =
          e.target !== this.gridContainer.getScrollContainer()
            ? Math.max(0, Math.min(port.height, e.clientY - port.top))
            : e.offsetY;
        const endRow = this.toRowFromMouse(moveY);
        if (endRow >= 1) {
          this.sheet!.selectRowRange(startRow, endRow);
          this.render();
        }
      };
      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
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

    let interval: NodeJS.Timeout | null = null;
    const onMove = (e: MouseEvent) => {
      let offsetX = e.offsetX;
      let offsetY = e.offsetY;

      // NOTE(hackerwins): If the mouse is outside the scroll container,
      // calculate the offset based on the sheet container.
      const port = this.viewport;
      if (e.target !== this.gridContainer.getScrollContainer()) {
        offsetX = Math.max(0, Math.min(port.width, e.clientX - port.left));
        offsetY = Math.max(0, Math.min(port.height, e.clientY - port.top));
      }

      this.sheet!.selectEnd(this.toRefFromMouse(offsetX, offsetY));
      this.render();

      const { clientX, clientY } = e;
      if (interval) {
        clearInterval(interval);
      }

      // Calculate the scroll offset based on the mouse position.
      const scroll = { x: 0, y: 0 };
      if (clientX <= port.left) {
        scroll.x = -ScrollSpeedMS;
      } else if (clientX >= port.width) {
        scroll.x = ScrollSpeedMS;
      }

      if (clientY <= port.top) {
        scroll.y = -ScrollSpeedMS;
      } else if (clientY >= port.height) {
        scroll.y = ScrollSpeedMS;
      }

      if (scroll.x !== 0 || scroll.y !== 0) {
        interval = setInterval(() => {
          this.gridContainer.scrollBy(scroll.x, scroll.y);
          this.sheet!.selectEnd(this.toRefFromMouse(offsetX!, offsetY!));
          this.render();
        }, ScrollIntervalMS);
      }
    };

    const onUp = () => {
      if (interval) {
        clearInterval(interval);
      }

      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
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

    const onMove = (e: MouseEvent) => {
      const currentPos = axis === 'column' ? e.clientX : e.clientY;
      const delta = currentPos - startPos;
      const minSize = axis === 'column' ? MinColumnWidth : MinRowHeight;
      const newSize = Math.max(minSize, startSize + delta);

      // During drag, only resize the handle being dragged (single index)
      dim.setSize(index, newSize);
      this.render();
    };

    const onUp = () => {
      scrollContainer.style.cursor = '';
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);

      // On mouseup, apply the final size to all selected indices
      const finalSize = dim.getSize(index);
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
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
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

    const onUp = () => {
      scrollContainer.style.cursor = '';
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);

      const dropIndex = this.dragMove?.dropIndex;
      this.dragMove = null;

      if (
        dropIndex !== undefined &&
        !(dropIndex >= srcIndex && dropIndex <= srcIndex + count)
      ) {
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
      } else {
        this.renderOverlay();
      }
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }

  /**
   * `handleFormulaInputKeydown` handles the keydown event for the formula input.
   */
  private async handleFormulaKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' && e.altKey) {
      e.preventDefault();
      document.execCommand('insertLineBreak');
      return;
    } else if (e.key === 'Enter') {
      e.preventDefault();
      await this.finishEditing();
      this.focusGrid();
      this.sheet!.move('down');
      this.render();
      this.scrollIntoView();
    } else if (e.key === 'Tab') {
      e.preventDefault();
      await this.finishEditing();
      this.focusGrid();
      this.sheet!.moveInRange(0, e.shiftKey ? -1 : 1);
      this.render();
      this.scrollIntoView();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      this.focusGrid();
      this.render();
    } else {
      if (!this.cellInput.isShown()) {
        this.showCellInput(true, true);
      }
    }
  }

  /**
   * `handleCellInputKeydown` handles the keydown event for the cell input.
   */
  private async handleCellInputKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' && e.altKey) {
      e.preventDefault();
      document.execCommand('insertLineBreak');
      return;
    } else if (e.key === 'Enter') {
      e.preventDefault();

      await this.finishEditing();
      this.sheet!.moveInRange(e.shiftKey ? -1 : 1, 0);
      this.render();
      this.scrollIntoView();
    } else if (e.key === 'Tab') {
      e.preventDefault();

      await this.finishEditing();
      this.sheet!.moveInRange(0, e.shiftKey ? -1 : 1);
      this.render();
      this.scrollIntoView();
    } else if (
      e.key.startsWith('Arrow') &&
      !this.cellInput.hasFormula() &&
      !this.editMode
    ) {
      e.preventDefault();

      await this.finishEditing();

      if (e.key === 'ArrowDown') {
        this.sheet!.move('down');
      } else if (e.key === 'ArrowUp') {
        this.sheet!.move('up');
      } else if (e.key === 'ArrowLeft') {
        this.sheet!.move('left');
      } else if (e.key === 'ArrowRight') {
        this.sheet!.move('right');
      }

      this.render();
      this.scrollIntoView();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      this.focusGrid();
      this.render();
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
    const move = async (
      direction: Direction,
      shift: boolean,
      ctrl: boolean,
    ) => {
      e.preventDefault();

      let changed = shift
        ? this.sheet!.resizeRange(direction)
        : ctrl
          ? await this.sheet!.moveToEdge(direction)
          : this.sheet!.move(direction);
      if (changed) {
        this.render();
        this.scrollIntoView();
      }
    };

    if (e.key === 'ArrowDown') {
      move('down', e.shiftKey, e.metaKey);
    } else if (e.key === 'ArrowUp') {
      move('up', e.shiftKey, e.metaKey);
    } else if (e.key === 'ArrowLeft') {
      move('left', e.shiftKey, e.metaKey);
    } else if (e.key === 'ArrowRight') {
      move('right', e.shiftKey, e.metaKey);
    } else if (e.key === 'a' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      await this.sheet!.selectAll();
      this.render();
    } else if (e.key === 'Tab') {
      e.preventDefault();

      this.sheet!.moveInRange(0, e.shiftKey ? -1 : 1);
      this.render();
      this.scrollIntoView();
    } else if (e.key === 'Enter') {
      e.preventDefault();

      if (this.sheet!.hasRange()) {
        this.sheet!.moveInRange(e.shiftKey ? -1 : 1, 0);
        this.render();
        this.scrollIntoView();
      } else {
        this.showCellInput();
      }
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();

      if (await this.sheet!.removeData()) {
        this.render();
      }
    } else if (!e.metaKey && !e.ctrlKey && this.isValidCellInput(e.key)) {
      this.showCellInput(true);
    } else if (e.key === 'z' && (e.metaKey || e.ctrlKey) && !e.shiftKey) {
      e.preventDefault();
      if (await this.sheet!.undo()) {
        this.render();
        this.scrollIntoView();
      }
    } else if (
      ((e.key === 'z' && e.shiftKey) || e.key === 'y') &&
      (e.metaKey || e.ctrlKey)
    ) {
      e.preventDefault();
      if (await this.sheet!.redo()) {
        this.render();
        this.scrollIntoView();
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      if (this.sheet!.getCopyRange()) {
        this.sheet!.clearCopyBuffer();
        this.renderOverlay();
      }
    } else if (e.key === 'c' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      await this.copy();
    } else if (e.key === 'v' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      await this.paste();
    } else if (e.key === 'b' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      await this.sheet!.toggleRangeStyle('b');
      this.render();
    } else if (e.key === 'i' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      await this.sheet!.toggleRangeStyle('i');
      this.render();
    } else if (e.key === 'u' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      await this.sheet!.toggleRangeStyle('u');
      this.render();
    }
  }

  /**
   * `reloadDimensions` reloads dimension sizes from the store into the local
   * DimensionIndex objects. Call this when a remote change arrives.
   */
  public async reloadDimensions() {
    await this.sheet!.loadDimensions();
    await this.sheet!.loadStyles();
    await this.sheet!.loadFreezePane();
    this.updateFreezeState();
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
    this.formulaBar.render();
    this.renderSheet();
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

    const startRow = this.rowDim.findIndex(unfrozenRowStart + scroll.top);
    const endRow =
      this.rowDim.findIndex(unfrozenRowStart + scroll.top + port.height) + 1;
    const startCol = this.colDim.findIndex(unfrozenColStart + scroll.left);
    const endCol =
      this.colDim.findIndex(unfrozenColStart + scroll.left + port.width) + 1;

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
  private async renderSheet() {
    const gridSize = this.gridSize;
    const freeze = this.freezeState;

    // Scroll container represents only unfrozen content, but we must add
    // the frozen pixel size back so the user can scroll far enough to reveal
    // the last rows/columns that would otherwise be hidden behind the frozen area.
    this.gridContainer.updateDummySize(
      gridSize.width + RowHeaderWidth,
      gridSize.height + DefaultCellHeight,
    );

    // Fetch grid for all visible quadrants
    const viewRange = this.viewRange;
    const fullRange: Range = [
      { r: Math.min(1, viewRange[0].r), c: Math.min(1, viewRange[0].c) },
      { r: viewRange[1].r, c: viewRange[1].c },
    ];
    const grid = await this.sheet!.fetchGrid(fullRange);

    this.gridCanvas.render(
      this.viewport,
      this.scroll,
      this.viewRange,
      this.sheet!.getActiveCell(),
      grid,
      this.rowDim,
      this.colDim,
      this.sheet!.getSelectionType(),
      this.sheet!.getRange(),
      freeze,
      this.freezeHandleHover,
      this.sheet!.getColStyles(),
      this.sheet!.getRowStyles(),
      this.sheet!.getSheetStyle(),
    );
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
