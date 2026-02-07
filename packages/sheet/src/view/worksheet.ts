import { Range, Ref, Direction } from '../model/types';
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
  BoundingRect,
  Position,
  Size,
  toBoundingRect,
  toRef,
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
  private dragMove: { axis: 'row' | 'column'; srcIndex: number; count: number; dropIndex: number } | null = null;

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
    this.formulaBar.initialize(sheet);
    this.addEventListeners();
    this.resizeObserver.observe(this.container);
    this.render();
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
   * `finishEditing` finishes the editing of the cell.
   */
  private async finishEditing() {
    if (this.formulaBar.isFocused()) {
      await this.sheet!.setData(
        this.sheet!.getActiveCell(),
        this.formulaBar.getValue(),
      );
      this.formulaBar.blur();
      this.cellInput.hide();
    } else if (this.cellInput.isFocused()) {
      await this.sheet!.setData(
        this.sheet!.getActiveCell(),
        this.cellInput.getValue(),
      );
      this.cellInput.hide();
    }
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
    if (this.formulaBar.isFocused()) {
      this.cellInput.setValue(this.formulaBar.getValue());
      return;
    } else if (this.cellInput.isFocused()) {
      this.formulaBar.setValue(this.cellInput.getValue());
      return;
    }
  }

  private handleDblClick(e: MouseEvent): void {
    this.showCellInput();
    e.preventDefault();
  }

  private handleContextMenu(e: MouseEvent): void {
    const scroll = this.scroll;
    const x = e.offsetX;
    const y = e.offsetY;

    const isRowHeader = x < RowHeaderWidth;
    const isColumnHeader = y < DefaultCellHeight;

    if (!isRowHeader && !isColumnHeader) {
      return;
    }

    e.preventDefault();

    if (isRowHeader) {
      const row = this.rowDim.findIndex(y - DefaultCellHeight + scroll.top);
      if (row < 1) return;

      this.contextMenu.show(e.clientX, e.clientY, [
        {
          label: 'Insert row above',
          action: () => {
            this.sheet!.insertRows(row).then(() => this.render());
          },
        },
        {
          label: 'Insert row below',
          action: () => {
            this.sheet!.insertRows(row + 1).then(() => this.render());
          },
        },
        {
          label: 'Delete row',
          action: () => {
            this.sheet!.deleteRows(row).then(() => this.render());
          },
        },
      ]);
    } else if (isColumnHeader) {
      const col = this.colDim.findIndex(x - RowHeaderWidth + scroll.left);
      if (col < 1) return;

      this.contextMenu.show(e.clientX, e.clientY, [
        {
          label: 'Insert column left',
          action: () => {
            this.sheet!.insertColumns(col).then(() => this.render());
          },
        },
        {
          label: 'Insert column right',
          action: () => {
            this.sheet!.insertColumns(col + 1).then(() => this.render());
          },
        },
        {
          label: 'Delete column',
          action: () => {
            this.sheet!.deleteColumns(col).then(() => this.render());
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

    // Check column header right edges
    if (y < DefaultCellHeight && x > RowHeaderWidth) {
      const absX = x - RowHeaderWidth + scroll.left;
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
      const absY = y - DefaultCellHeight + scroll.top;
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

  private handleMouseMove(e: MouseEvent): void {
    const result = this.detectResizeEdge(e.offsetX, e.offsetY);
    const changed =
      result?.axis !== this.resizeHover?.axis ||
      result?.index !== this.resizeHover?.index;

    if (changed) {
      this.resizeHover = result;
    }

    const scrollContainer = this.gridContainer.getScrollContainer();
    if (result) {
      scrollContainer.style.cursor =
        result.axis === 'column' ? 'col-resize' : 'row-resize';
    } else {
      // Check if hovering over a selected header → show grab cursor
      const scroll = this.scroll;
      const x = e.offsetX;
      const y = e.offsetY;
      const selected = this.sheet?.getSelectedIndices();

      if (selected) {
        const isOverSelectedHeader = selected.axis === 'column'
          ? (y < DefaultCellHeight && x > RowHeaderWidth &&
            (() => {
              const col = this.colDim.findIndex(x - RowHeaderWidth + scroll.left);
              return col >= selected.from && col <= selected.to;
            })())
          : (x < RowHeaderWidth && y > DefaultCellHeight &&
            (() => {
              const row = this.rowDim.findIndex(y - DefaultCellHeight + scroll.top);
              return row >= selected.from && row <= selected.to;
            })());

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
    // Check for resize edge first
    const resizeEdge = this.detectResizeEdge(e.offsetX, e.offsetY);
    if (resizeEdge) {
      e.preventDefault();
      this.startResize(resizeEdge.axis, resizeEdge.index, e);
      return;
    }

    const scroll = this.scroll;
    const x = e.offsetX;
    const y = e.offsetY;
    const isColumnHeader = y < DefaultCellHeight && x > RowHeaderWidth;
    const isRowHeader = x < RowHeaderWidth && y > DefaultCellHeight;

    // Handle column header click
    if (isColumnHeader) {
      e.preventDefault();
      await this.finishEditing();
      const col = this.colDim.findIndex(x - RowHeaderWidth + scroll.left);
      if (col < 1) return;

      // Check if clicking on already-selected column header → start drag-move
      const selected = this.sheet!.getSelectedIndices();
      if (selected && selected.axis === 'column' && col >= selected.from && col <= selected.to) {
        this.startDragMove('column', selected.from, selected.to - selected.from + 1, e);
        return;
      }

      this.sheet!.selectColumn(col);
      this.render();

      const startCol = col;
      const onMove = (e: MouseEvent) => {
        const port = this.viewport;
        const moveX = e.target !== this.gridContainer.getScrollContainer()
          ? Math.max(0, Math.min(port.width, e.clientX - port.left))
          : e.offsetX;
        const endCol = this.colDim.findIndex(moveX - RowHeaderWidth + this.scroll.left);
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
      const row = this.rowDim.findIndex(y - DefaultCellHeight + scroll.top);
      if (row < 1) return;

      // Check if clicking on already-selected row header → start drag-move
      const selected = this.sheet!.getSelectedIndices();
      if (selected && selected.axis === 'row' && row >= selected.from && row <= selected.to) {
        this.startDragMove('row', selected.from, selected.to - selected.from + 1, e);
        return;
      }

      this.sheet!.selectRow(row);
      this.render();

      const startRow = row;
      const onMove = (e: MouseEvent) => {
        const port = this.viewport;
        const moveY = e.target !== this.gridContainer.getScrollContainer()
          ? Math.max(0, Math.min(port.height, e.clientY - port.top))
          : e.offsetY;
        const endRow = this.rowDim.findIndex(moveY - DefaultCellHeight + this.scroll.top);
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
    this.sheet!.selectStart(
      toRef(
        e.offsetX + this.scroll.left,
        e.offsetY + this.scroll.top,
        this.rowDim,
        this.colDim,
      ),
    );
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

      this.sheet!.selectEnd(
        toRef(
          offsetX + this.scroll.left,
          offsetY + this.scroll.top,
          this.rowDim,
          this.colDim,
        ),
      );
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
          this.sheet!.selectEnd(
            toRef(
              offsetX! + this.scroll.left,
              offsetY! + this.scroll.top,
              this.rowDim,
              this.colDim,
            ),
          );
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

    const onMove = (e: MouseEvent) => {
      const currentPos = axis === 'column' ? e.clientX : e.clientY;
      const delta = currentPos - startPos;
      const minSize = axis === 'column' ? MinColumnWidth : MinRowHeight;
      const newSize = Math.max(minSize, startSize + delta);

      // Only update local DimensionIndex for visual feedback during drag
      dim.setSize(index, newSize);
      this.render();
    };

    const onUp = () => {
      scrollContainer.style.cursor = '';
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);

      // Persist the final size to the store on mouseup
      const finalSize = dim.getSize(index);
      if (axis === 'column') {
        this.sheet!.setColumnWidth(index, finalSize);
      } else {
        this.sheet!.setRowHeight(index, finalSize);
      }
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
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
        const moveX = e.target !== scrollContainer
          ? Math.max(0, Math.min(port.width, e.clientX - port.left))
          : e.offsetX;
        const absX = moveX - RowHeaderWidth + this.scroll.left;
        const col = dim.findIndex(absX);
        // Snap to nearest edge
        const colOffset = dim.getOffset(col);
        const colMid = colOffset + dim.getSize(col) / 2;
        return absX < colMid ? col : col + 1;
      } else {
        const moveY = e.target !== scrollContainer
          ? Math.max(0, Math.min(port.height, e.clientY - port.top))
          : e.offsetY;
        const absY = moveY - DefaultCellHeight + this.scroll.top;
        const row = dim.findIndex(absY);
        const rowOffset = dim.getOffset(row);
        const rowMid = rowOffset + dim.getSize(row) / 2;
        return absY < rowMid ? row : row + 1;
      }
    };

    this.dragMove = { axis, srcIndex, count, dropIndex: computeDropIndex(startEvent) };
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

      if (dropIndex !== undefined && !(dropIndex >= srcIndex && dropIndex <= srcIndex + count)) {
        const movePromise = axis === 'row'
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
    if (e.key === 'Enter') {
      await this.finishEditing();
      this.sheet!.move('down');
      this.scrollIntoView();
      e.preventDefault();
    } else if (e.key === 'Escape') {
      this.formulaBar.setValue(
        await this.sheet!.toInputString(this.sheet!.getActiveCell()),
      );
      this.cellInput.hide();
      this.formulaBar.blur();
      e.preventDefault();
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
    if (e.key === 'Enter') {
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
    } else if (e.key.startsWith('Arrow') && !this.cellInput.hasFormula()) {
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
      this.cellInput.hide();
    }
  }

  private async copy(): Promise<void> {
    const data = await this.sheet!.copy();
    await navigator.clipboard.writeText(data);
  }

  private async paste(): Promise<void> {
    try {
      const text = await navigator.clipboard.readText();
      await this.sheet!.paste(text);
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
    } else if (e.key === 'c' && e.metaKey) {
      e.preventDefault();
      await this.copy();
    } else if (e.key === 'v' && e.metaKey) {
      e.preventDefault();
      await this.paste();
    }
  }

  /**
   * `reloadDimensions` reloads dimension sizes from the store into the local
   * DimensionIndex objects. Call this when a remote change arrives.
   */
  public async reloadDimensions() {
    await this.sheet!.loadDimensions();
  }

  /**
   * `render` renders the spreadsheet in the container.
   */
  public render() {
    this.formulaBar.render();
    this.renderSheet();
    this.renderOverlay();
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
      this.dragMove ? { axis: this.dragMove.axis, dropIndex: this.dragMove.dropIndex } : null,
    );
  }

  /**
   * `viewRange` returns the visible range of the grid.
   */
  private get viewRange(): Range {
    const scroll = this.scroll;
    const port = this.viewport;

    const startRow = this.rowDim.findIndex(scroll.top);
    const endRow = this.rowDim.findIndex(scroll.top + port.height) + 1;
    const startCol = this.colDim.findIndex(scroll.left);
    const endCol = this.colDim.findIndex(scroll.left + port.width) + 1;

    return [
      { r: startRow, c: startCol },
      { r: endRow, c: endCol },
    ];
  }

  /**
   * `scrollIntoView` scrolls the active cell into view.
   */
  private scrollIntoView(ref: Ref = this.sheet!.getActiveCell()) {
    const scroll = this.scroll;
    const cell = toBoundingRect(ref, { left: 0, top: 0 }, this.rowDim, this.colDim);
    const view = {
      left: scroll.left + RowHeaderWidth,
      top: scroll.top + DefaultCellHeight,
      width: this.viewport.width - RowHeaderWidth,
      height: this.viewport.height - DefaultCellHeight,
    };

    let changed = false;
    if (cell.left < view.left) {
      this.scroll = { left: cell.left - RowHeaderWidth };
      changed = true;
    } else if (cell.left + cell.width > view.left + view.width) {
      this.scroll = {
        left: cell.left + cell.width - view.width - RowHeaderWidth,
      };
      changed = true;
    }

    if (cell.top < view.top) {
      this.scroll = { top: cell.top - DefaultCellHeight };
      changed = true;
    } else if (cell.top + cell.height > view.top + view.height) {
      this.scroll = {
        top: cell.top + cell.height - view.height - DefaultCellHeight,
      };
      changed = true;
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
    const cell = this.sheet!.getActiveCell();
    const rect = toBoundingRect(cell, this.scroll, this.rowDim, this.colDim);
    const value = withoutValue ? '' : await this.sheet!.toInputString(cell);
    this.cellInput.show(
      rect.left,
      rect.top,
      value,
      !withoutFocus,
      rect.width,
      rect.height,
    );
  }

  /**
   * `isValidCellInput` checks if the key is a valid cell input.
   */
  private isValidCellInput(key: string): boolean {
    return /^[a-zA-Z0-9 =:\-]$/.test(key);
  }

  /**
   * `renderSheet` renders the spreadsheet.
   */
  private async renderSheet() {
    const gridSize = this.gridSize;
    this.gridContainer.updateDummySize(
      gridSize.width + RowHeaderWidth,
      gridSize.height + DefaultCellHeight,
    );

    const grid = await this.sheet!.fetchGrid(this.viewRange);
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
