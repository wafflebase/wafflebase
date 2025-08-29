import { Range, Ref, Grid, Cell, Direction } from '../model/types';
import { toSref, toColumnLabel } from '../model/coordinates';
import { Sheet } from '../model/sheet';
import { Theme, ThemeKey, getThemeColor } from './theme';
import { FormulaBar, FormulaBarHeight, FormulaBarMargin } from './formulabar';
import { CellInput } from './cellinput';
import { Overlay } from './overlay';
import {
  DefaultCellWidth,
  DefaultCellHeight,
  RowHeaderWidth,
  CellBorderWidth,
  HeaderTextAlign,
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
  private theme: Theme;

  private container: HTMLDivElement;

  private formulaBar: FormulaBar;
  private cellInput: CellInput;
  private overlay: Overlay;

  private sheetContainer: HTMLDivElement;
  private scrollContainer: HTMLDivElement;
  private dummyContainer: HTMLDivElement;
  private gridCanvas: HTMLCanvasElement;

  private listeners: Array<{
    element: EventTarget;
    type: string;
    handler: EventListenerOrEventListenerObject;
  }> = [];

  private resizeObserver?: ResizeObserver;

  private boundRender: () => void;
  private boundHandleGridKeydown: (e: KeyboardEvent) => void;
  private boundHandleFormulaInputKeydown: (e: KeyboardEvent) => void;
  private boundHandleCellInputKeydown: (e: KeyboardEvent) => void;
  private boundHandleMouseDown: (e: MouseEvent) => void;
  private boundHandleDblClick: (e: MouseEvent) => void;
  private boundHandleKeyDown: (e: KeyboardEvent) => void;
  private boundHandleKeyUp: () => void;

  constructor(container: HTMLDivElement, theme: Theme = 'light') {
    this.container = container;
    this.theme = theme;

    this.formulaBar = new FormulaBar(theme);
    this.container.appendChild(this.formulaBar.getContainer());

    this.sheetContainer = document.createElement('div');
    this.sheetContainer.style.position = 'relative';
    this.sheetContainer.style.width = '100%';
    this.sheetContainer.style.height = `calc(100% - ${FormulaBarHeight + FormulaBarMargin * 2}px)`;

    this.overlay = new Overlay(theme);
    this.sheetContainer.appendChild(this.overlay.getContainer());

    this.scrollContainer = document.createElement('div');
    this.scrollContainer.style.position = 'absolute';
    this.scrollContainer.style.overflow = 'auto';
    this.scrollContainer.style.width = '100%';
    this.scrollContainer.style.height = '100%';
    this.scrollContainer.style.zIndex = '1';

    this.dummyContainer = document.createElement('div');
    this.dummyContainer.style.margin = '0px';
    this.dummyContainer.style.padding = '0px';
    this.scrollContainer.appendChild(this.dummyContainer);
    this.sheetContainer.appendChild(this.scrollContainer);

    this.gridCanvas = this.sheetContainer.appendChild(
      document.createElement('canvas'),
    );
    this.gridCanvas.style.position = 'absolute';

    this.cellInput = new CellInput(theme);
    this.sheetContainer.appendChild(this.cellInput.getContainer());

    this.container.appendChild(this.sheetContainer);

    this.boundRender = this.render.bind(this);
    this.boundHandleGridKeydown = this.handleGridKeydown.bind(this);
    this.boundHandleFormulaInputKeydown =
      this.handleFormulaInputKeydown.bind(this);
    this.boundHandleCellInputKeydown = this.handleCellInputKeydown.bind(this);
    this.boundHandleMouseDown = this.handleMouseDown.bind(this);
    this.boundHandleDblClick = this.handleDblClick.bind(this);
    this.boundHandleKeyDown = this.handleKeyDown.bind(this);
    this.boundHandleKeyUp = this.handleKeyUp.bind(this);
    this.resizeObserver = new ResizeObserver(() => {
      this.boundRender();
    });
  }

  public initialize(sheet: Sheet) {
    this.sheet = sheet;
    this.formulaBar.initialize(sheet);
    this.addEventListeners();
    this.resizeObserver?.observe(this.container);
    this.render();
  }

  public cleanup() {
    this.removeAllEventListeners();
    this.resizeObserver?.disconnect();
    this.resizeObserver = undefined;
    this.formulaBar.cleanup();
    this.cellInput.cleanup();
    this.overlay.cleanup();
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
      this.boundHandleFormulaInputKeydown(e);
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

  /**
   * `addEventLisnters` adds event listeners to the spreadsheet.
   */
  private addEventListeners() {
    this.addEventListener(window, 'resize', this.boundRender);
    this.addEventListener(this.scrollContainer, 'scroll', this.boundRender);
    this.addEventListener(
      this.scrollContainer,
      'mousedown',
      this.boundHandleMouseDown,
    );
    this.addEventListener(
      this.scrollContainer,
      'dblclick',
      this.boundHandleDblClick,
    );
    this.addEventListener(document, 'keydown', this.boundHandleKeyDown);
    this.addEventListener(document, 'keyup', this.boundHandleKeyUp);
  }

  private async handleMouseDown(e: MouseEvent) {
    await this.finishEditing();
    this.sheet!.selectStart(toRef(e.offsetX, e.offsetY));
    this.render();

    let scrollInterval: NodeJS.Timeout | null = null;
    let offsetX: number | null = null;
    let offsetY: number | null = null;
    const onMove = (e: MouseEvent) => {
      offsetX = e.offsetX;
      offsetY = e.offsetY;

      const viewport = this.viewport;
      // NOTE(hackerwins): If the mouse is outside the scroll container,
      // calculate the offset based on the sheet container.
      if (e.target !== this.scrollContainer) {
        offsetX = Math.max(
          0,
          Math.min(viewport.width, e.clientX - viewport.left),
        );
        offsetY = Math.max(
          0,
          Math.min(viewport.height, e.clientY - viewport.top),
        );
      }

      this.sheet!.selectEnd(
        toRef(offsetX + this.scroll.left, offsetY + this.scroll.top),
      );
      this.render();

      const { clientX, clientY } = e;
      if (scrollInterval) {
        clearInterval(scrollInterval);
      }

      // Calculate the scroll offset based on the mouse position.
      const scrollOffset = { x: 0, y: 0 };
      if (clientX <= viewport.left) {
        scrollOffset.x = -ScrollSpeedMS;
      } else if (clientX >= viewport.width) {
        scrollOffset.x = ScrollSpeedMS;
      }

      if (clientY <= viewport.top) {
        scrollOffset.y = -ScrollSpeedMS;
      } else if (clientY >= viewport.height) {
        scrollOffset.y = ScrollSpeedMS;
      }

      if (scrollOffset.x !== 0 || scrollOffset.y !== 0) {
        scrollInterval = setInterval(() => {
          this.scrollContainer.scrollBy(scrollOffset.x, scrollOffset.y);
          this.sheet!.selectEnd(
            toRef(offsetX! + this.scroll.left, offsetY! + this.scroll.top),
          );
          this.render();
        }, ScrollIntervalMS);
      }
    };

    const onUp = () => {
      if (scrollInterval) {
        clearInterval(scrollInterval);
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
  private async handleFormulaInputKeydown(e: KeyboardEvent) {
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
    this.paintSheet();
    this.overlay.render(
      this.viewport,
      this.scroll,
      this.sheet!.getActiveCell(),
      this.sheet!.getRange(),
    );
  }

  /**
   * `viewRange` returns the visible range of the grid.
   */
  private get viewRange(): Range {
    const scroll = this.scroll;
    const viewport = this.viewport;

    const startRow = Math.floor(scroll.top / DefaultCellHeight) + 1;
    const endRow =
      Math.ceil((scroll.top + viewport.height) / DefaultCellHeight) + 1;
    const startCol = Math.floor(scroll.left / DefaultCellWidth) + 1;
    const endCol =
      Math.ceil((scroll.left + viewport.width) / DefaultCellWidth) + 1;

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
    const activeCell = this.sheet!.getActiveCell();
    const rect = toBoundingRect(activeCell, this.scroll);
    const value = withoutValue
      ? ''
      : await this.sheet!.toInputString(activeCell);
    this.cellInput.show(rect.left, rect.top, value, !withoutFocus);
  }

  /**
   * `isValidCellInput` checks if the key is a valid cell input.
   */
  private isValidCellInput(key: string): boolean {
    return /^[a-zA-Z0-9 =:\-]$/.test(key);
  }

  /**
   * `paintSheet` paints the spreadsheet.
   */
  private async paintSheet() {
    this.paintDummy();
    this.paintGrid();

    // TODO(hackerwins): There is a flickering issue when the grid is painted.
    // We need to prefetch the grid with buffer and then paint the grid.
    const grid = await this.sheet!.fetchGrid(this.viewRange);
    this.paintGrid(grid);
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
    return this.scrollContainer.getBoundingClientRect();
  }

  /**
   * `scroll` returns the scroll position of the scroll container.
   */
  private get scroll(): Position {
    return {
      left: this.scrollContainer.scrollLeft,
      top: this.scrollContainer.scrollTop,
    };
  }

  /**
   * `scroll` sets the scroll position of the scroll container.
   */
  private set scroll(position: { left?: number; top?: number }) {
    if (position.left !== undefined) {
      this.scrollContainer.scrollLeft = position.left;
    }
    if (position.top !== undefined) {
      this.scrollContainer.scrollTop = position.top;
    }
  }

  /**
   * `paintDummy` paints the dummy container.
   */
  private paintDummy() {
    const gridSize = this.gridSize;
    this.dummyContainer.style.width = gridSize.width + RowHeaderWidth + 'px';
    this.dummyContainer.style.height =
      gridSize.height + DefaultCellHeight + 'px';
  }

  /**
   * `paintGrid` paints the grid.
   */
  private paintGrid(grid?: Grid) {
    this.gridCanvas.width = 0;
    this.gridCanvas.height = 0;

    const ctx = this.gridCanvas.getContext('2d')!;
    const ratio = window.devicePixelRatio || 1;
    const viewport = this.viewport;
    const scroll = this.scroll;

    this.gridCanvas.width = viewport.width * ratio;
    this.gridCanvas.height = viewport.height * ratio;
    this.gridCanvas.style.width = viewport.width + 'px';
    this.gridCanvas.style.height = viewport.height + 'px';
    ctx.scale(ratio, ratio);

    const [startID, endID] = this.viewRange;
    const ref = this.sheet!.getActiveCell();

    // Paint cells
    for (let row = startID.r; row <= endID.r + 1; row++) {
      for (let col = startID.c; col <= endID.c + 1; col++) {
        this.paintCell(
          ctx,
          { r: row, c: col },
          grid?.get(toSref({ r: row, c: col })),
        );
      }
    }

    // Paint column header
    for (let col = startID.c; col <= endID.c; col++) {
      const x = RowHeaderWidth + DefaultCellWidth * (col - 1) - scroll.left;
      const y = 0;
      this.paintHeader(
        ctx,
        x,
        y,
        DefaultCellWidth,
        toColumnLabel(col),
        ref.c === col,
      );
    }

    // Paint row header
    for (let row = startID.r; row <= endID.r; row++) {
      const x = 0;
      const y = row * DefaultCellHeight - scroll.top;
      this.paintHeader(ctx, x, y, RowHeaderWidth, String(row), ref.r === row);
    }
  }

  /**
   * `paintHeader` paints the header.
   */
  private paintHeader(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    width: number,
    label: string,
    selected: boolean,
  ) {
    ctx.fillStyle = selected
      ? this.getThemeColor('headerActiveBGColor')
      : this.getThemeColor('headerBGColor');
    ctx.fillRect(x, y, width, DefaultCellHeight);
    ctx.strokeStyle = this.getThemeColor('cellBorderColor');
    ctx.lineWidth = CellBorderWidth;
    ctx.strokeRect(x, y, width, DefaultCellHeight);
    ctx.fillStyle = this.getThemeColor('cellTextColor');
    ctx.textAlign = HeaderTextAlign;
    ctx.font = selected ? 'bold 10px Arial' : '10px Arial';
    ctx.fillText(label, x + width / 2, y + 15);
  }

  /**
   * `paintCell` paints the cell.
   */
  private paintCell(ctx: CanvasRenderingContext2D, id: Ref, cell?: Cell) {
    const rect = toBoundingRect(id, this.scroll);

    ctx.strokeStyle = this.getThemeColor('cellTextColor');
    ctx.lineWidth = CellBorderWidth;
    ctx.strokeRect(rect.left, rect.top, DefaultCellWidth, DefaultCellHeight);
    ctx.fillStyle = this.getThemeColor('cellBGColor');
    ctx.fillRect(rect.left, rect.top, DefaultCellWidth, DefaultCellHeight);

    const data = cell?.v || '';
    if (data) {
      ctx.fillStyle = this.getThemeColor('cellTextColor');
      ctx.font = '12px Arial';
      ctx.fillText(data, rect.left + 3, rect.top + 15);
    }
  }

  private getThemeColor(key: ThemeKey): string {
    return getThemeColor(this.theme, key);
  }
}
