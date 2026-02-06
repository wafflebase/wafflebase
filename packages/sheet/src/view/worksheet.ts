import { Range, Ref, Direction } from '../model/types';
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
  private boundHandleContextMenu: (e: MouseEvent) => void;

  constructor(container: HTMLDivElement, theme: Theme = 'light') {
    this.container = container;

    this.formulaBar = new FormulaBar(theme);
    this.gridContainer = new GridContainer(theme);
    this.overlay = new Overlay(theme);
    this.gridCanvas = new GridCanvas(theme);
    this.cellInput = new CellInput(theme);
    this.contextMenu = new ContextMenu(theme);

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
    this.boundHandleContextMenu = this.handleContextMenu.bind(this);
    this.resizeObserver = new ResizeObserver(() => this.boundRender());
  }

  public initialize(sheet: Sheet) {
    this.sheet = sheet;
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
      const row = Math.floor((y + scroll.top) / DefaultCellHeight);
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
      const col = Math.floor((x - RowHeaderWidth + scroll.left) / DefaultCellWidth) + 1;
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
    this.gridContainer.addEventListener('dblclick', this.boundHandleDblClick);
    this.gridContainer.addEventListener(
      'contextmenu',
      this.boundHandleContextMenu,
    );

    this.addEventListener(document, 'keydown', this.boundHandleKeyDown);
    this.addEventListener(document, 'keyup', this.boundHandleKeyUp);
  }

  private async handleMouseDown(e: MouseEvent) {
    await this.finishEditing();
    this.sheet!.selectStart(toRef(e.offsetX, e.offsetY));
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
        toRef(offsetX + this.scroll.left, offsetY + this.scroll.top),
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
            toRef(offsetX! + this.scroll.left, offsetY! + this.scroll.top),
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
    );
  }

  /**
   * `viewRange` returns the visible range of the grid.
   */
  private get viewRange(): Range {
    const scroll = this.scroll;
    const port = this.viewport;

    const startRow = Math.floor(scroll.top / DefaultCellHeight) + 1;
    const endRow =
      Math.ceil((scroll.top + port.height) / DefaultCellHeight) + 1;
    const startCol = Math.floor(scroll.left / DefaultCellWidth) + 1;
    const endCol = Math.ceil((scroll.left + port.width) / DefaultCellWidth) + 1;

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
    const cell = toBoundingRect(ref);
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
    const rect = toBoundingRect(cell, this.scroll);
    const value = withoutValue ? '' : await this.sheet!.toInputString(cell);
    this.cellInput.show(rect.left, rect.top, value, !withoutFocus);
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
    );
  }

  private get gridSize(): Size {
    const dimension = this.sheet!.getDimension();
    return {
      width: dimension.columns * DefaultCellWidth,
      height: dimension.rows * DefaultCellHeight,
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
