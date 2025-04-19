import { setTextRange, toTextRange } from './textrange';
import { extractTokens, Token } from '../formula/formula';
import { toSref, toColumnLabel } from '../worksheet/coordinates';
import { Sheet } from '../worksheet/sheet';
import { Range, Ref, Grid, Cell, Direction } from '../worksheet/types';
import { escapeHTML } from './htmlutils';
import { Theme } from './spreadsheet';

const FormulaBarHeight = 23;
const FormulaBarMargin = 10;
const DefaultCellWidth = 100;
const DefaultCellHeight = 23;
const CellBorderWidth = 0.5;

const LightTheme = {
  cellBorderColor: '#D3D3D3',
  cellBGColor: '#FFFFFF',
  cellTextColor: '#000000',
  activeCellColor: '#E6C746',
  selectionBGColor: 'rgba(230, 199, 70, 0.1)',
  headerBGColor: '#F0F0F0',
  headerActiveBGColor: '#E6C746',
};

const DarkTheme = {
  cellBorderColor: '#4A4A4A',
  cellBGColor: '#1E1E1E',
  cellTextColor: '#FFFFFF',
  activeCellColor: '#D4B73E',
  selectionBGColor: 'rgba(212, 183, 62, 0.1)',
  headerBGColor: '#2D2D2D',
  headerActiveBGColor: '#D4B73E',
};

const HeaderTextAlign = 'center';
const RowHeaderWidth = 50;

const ScrollIntervalMS = 10;
const ScrollSpeedMS = 10;

const TokenColorMap = new Map<string, string>([
  ['REFERENCE', 'green'],
  ['NUM', 'blue'],
]);

/**
 * BoundingRect represents the bounding rectangle of a cell.
 *
 * TODO(hackerwins): We need to use `bigint` for the coordinates
 * and `number` for the width and height. Because the coordinates
 * can be very large for big dimensions of the grid.
 */
type BoundingRect = Position & Size;

/**
 * Position represents the position of the rectangle.
 */
type Position = {
  left: number;
  top: number;
};

/**
 * Size represents the size of the rectangle.
 */
type Size = {
  width: number;
  height: number;
};

/**
 * Worksheet represents the worksheet of the spreadsheet. It handles the
 * rendering of the grid, formula bar, and the overlay.
 */
export class Worksheet {
  private sheet?: Sheet;
  private theme: Theme;

  private container: HTMLDivElement;
  private formulaBar: HTMLDivElement;
  private cellLabel: HTMLDivElement;
  private formulaInput: HTMLInputElement;
  private sheetContainer: HTMLDivElement;
  private scrollContainer: HTMLDivElement;
  private dummyContainer: HTMLDivElement;
  private inputContainer: HTMLDivElement;
  private cellInput: HTMLDivElement;
  private gridCanvas: HTMLCanvasElement;
  private overlayCanvas: HTMLCanvasElement;

  private listeners: Array<{
    element: EventTarget;
    type: string;
    handler: EventListenerOrEventListenerObject;
  }> = [];

  private boundRender: () => void;
  private boundHandleGridKeydown: (e: KeyboardEvent) => void;
  private boundHandleFormulaInputKeydown: (e: KeyboardEvent) => void;
  private boundHandleCellInputKeydown: (e: KeyboardEvent) => void;
  private boundHandleMouseDown: (e: MouseEvent) => void;
  private boundHandleDblClick: (e: MouseEvent) => void;
  private boundHandleCellInput: () => void;
  private boundHandleKeyDown: (e: KeyboardEvent) => void;
  private boundHandleKeyUp: () => void;

  constructor(container: HTMLDivElement, theme: Theme = 'light') {
    this.container = container;
    this.theme = theme;

    this.formulaBar = document.createElement('div');
    this.formulaBar.style.height = `${FormulaBarHeight}px`;
    this.formulaBar.style.margin = `${FormulaBarMargin}px 0px`;
    this.formulaBar.style.display = 'flex';
    this.formulaBar.style.alignItems = 'center';
    this.formulaBar.style.borderTop = `1px solid ${this.getThemeColor('cellBorderColor')}`;
    this.formulaBar.style.borderBottom = `1px solid ${this.getThemeColor('cellBorderColor')}`;
    this.formulaBar.style.justifyContent = 'flex-start';

    this.cellLabel = document.createElement('div');
    this.cellLabel.style.width = '120px';
    this.cellLabel.style.textAlign = 'center';
    this.cellLabel.style.font = '12px Arial';
    this.cellLabel.style.borderRight = `1px solid ${this.getThemeColor('cellBorderColor')}`;
    this.formulaBar.appendChild(this.cellLabel);

    this.formulaInput = document.createElement('input');
    this.formulaInput.style.margin = '20px';
    this.formulaInput.style.width = '100%';
    this.formulaInput.style.height = '12px';
    this.formulaInput.style.border = 'none';
    this.formulaInput.style.font = '12px Arial';
    this.formulaInput.style.outlineWidth = '0';
    this.formulaBar.appendChild(this.formulaInput);

    this.sheetContainer = document.createElement('div');
    this.sheetContainer.style.position = 'relative';
    this.sheetContainer.style.width = '100%';
    this.sheetContainer.style.height = `calc(100% - ${FormulaBarHeight + FormulaBarMargin * 2}px)`;

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

    this.inputContainer = document.createElement('div');
    this.inputContainer.style.position = 'absolute';
    this.inputContainer.style.left = '-1000px';
    this.inputContainer.style.width = DefaultCellWidth + 'px';
    this.inputContainer.style.height = DefaultCellHeight + 'px';
    this.inputContainer.style.zIndex = '1';
    this.inputContainer.style.margin = '0px';

    this.cellInput = document.createElement('div');
    this.cellInput.contentEditable = 'true';
    this.cellInput.style.width = '100%';
    this.cellInput.style.height = '100%';
    this.cellInput.style.border = 'none';
    this.cellInput.style.outline = `2px solid ${this.getThemeColor('activeCellColor')}`;
    this.cellInput.style.fontFamily = 'Arial, sans-serif';
    this.cellInput.style.fontSize = '14px';
    this.cellInput.style.fontWeight = 'normal';
    this.cellInput.style.lineHeight = '1.5';
    this.cellInput.style.color = this.getThemeColor('cellTextColor');
    this.cellInput.style.backgroundColor = this.getThemeColor('cellBGColor');
    this.inputContainer.appendChild(this.cellInput);

    this.gridCanvas = this.sheetContainer.appendChild(
      document.createElement('canvas'),
    );
    this.overlayCanvas = this.sheetContainer.appendChild(
      document.createElement('canvas'),
    );
    this.sheetContainer.appendChild(this.scrollContainer);
    this.sheetContainer.appendChild(this.inputContainer);
    this.gridCanvas.style.position = 'absolute';
    this.overlayCanvas.style.position = 'absolute';
    this.overlayCanvas.style.zIndex = '1';

    this.container.appendChild(this.formulaBar);
    this.container.appendChild(this.sheetContainer);

    this.boundRender = this.render.bind(this);
    this.boundHandleGridKeydown = this.handleGridKeydown.bind(this);
    this.boundHandleFormulaInputKeydown =
      this.handleFormulaInputKeydown.bind(this);
    this.boundHandleCellInputKeydown = this.handleCellInputKeydown.bind(this);
    this.boundHandleMouseDown = this.handleMouseDown.bind(this);
    this.boundHandleDblClick = this.handleDblClick.bind(this);
    this.boundHandleCellInput = this.paintCellInput.bind(this);
    this.boundHandleKeyDown = this.handleKeyDown.bind(this);
    this.boundHandleKeyUp = this.handleKeyUp.bind(this);
  }

  public initialize(sheet: Sheet) {
    this.sheet = sheet;
    this.addEventListeners();
    this.render();
  }

  public cleanup() {
    this.removeAllEventListeners();
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
    if (this.isFormulaInputFocused()) {
      await this.sheet!.setData(
        this.sheet!.getActiveCell(),
        this.formulaInput.value,
      );
      this.formulaInput.blur();
      this.hideCellInput();
    } else if (this.isCellInputFocused()) {
      await this.sheet!.setData(
        this.sheet!.getActiveCell(),
        this.cellInput.innerText,
      );
      this.cellInput.blur();
      this.hideCellInput();
    }
  }

  private handleKeyDown(e: KeyboardEvent): void {
    if (this.isFormulaInputFocused()) {
      this.boundHandleFormulaInputKeydown(e);
      return;
    } else if (this.isCellInputFocused()) {
      this.boundHandleCellInputKeydown(e);
      return;
    }

    this.boundHandleGridKeydown(e);
  }

  private handleKeyUp(): void {
    if (this.isFormulaInputFocused()) {
      this.cellInput.innerText = this.formulaInput.value;
      return;
    } else if (this.isCellInputFocused()) {
      this.formulaInput.value = this.cellInput.innerText;
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
    this.addEventListener(this.cellInput, 'input', this.boundHandleCellInput);
    this.addEventListener(document, 'keydown', this.boundHandleKeyDown);
    this.addEventListener(document, 'keyup', this.boundHandleKeyUp);
  }

  /**
   * `isFormulaInputFocused` checks if the formula input is focused.
   */
  private isFormulaInputFocused(): boolean {
    return document.activeElement === this.formulaInput;
  }

  private async handleMouseDown(e: MouseEvent) {
    await this.finishEditing();
    this.sheet!.selectStart(this.toRef(e.offsetX, e.offsetY));
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
        this.toRef(offsetX + this.scroll.left, offsetY + this.scroll.top),
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
            this.toRef(offsetX! + this.scroll.left, offsetY! + this.scroll.top),
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
      this.formulaInput.value = await this.sheet!.toInputString(
        this.sheet!.getActiveCell(),
      );
      this.hideCellInput();
      this.formulaInput.blur();
      e.preventDefault();
    } else {
      if (!this.isCellInputShown()) {
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
    } else if (e.key.startsWith('Arrow') && !this.hasFormulaInCellInput()) {
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
      this.hideCellInput();
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

  public getThemeColor(key: keyof typeof LightTheme): string {
    if (this.theme === 'system') {
      const prefersDark = window.matchMedia?.(
        '(prefers-color-scheme: dark)',
      ).matches;
      return (prefersDark ? DarkTheme : LightTheme)[key];
    }

    if (this.theme === 'light') {
      return LightTheme[key];
    }

    return DarkTheme[key];
  }

  /**
   * `render` renders the spreadsheet in the container.
   */
  private render() {
    this.paintFormulaBar();
    this.paintSheet();
    this.paintOverlay();
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
    const cell = this.toBoundingRect(ref, true);
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
   * `isCellInputShown` checks if the cell input is shown.
   */
  private isCellInputShown(): boolean {
    return this.inputContainer.style.left !== '-1000px';
  }

  /**
   * `hasFormulaInCellInput` checks if the cell input has a formula.
   */
  private hasFormulaInCellInput(): boolean {
    return this.cellInput.innerText.startsWith('=');
  }

  /**
   * `showCellInput` shows the cell input.
   */
  private async showCellInput(
    withoutValue: boolean = false,
    withoutFocus: boolean = false,
  ) {
    const selection = this.sheet!.getActiveCell();
    const rect = this.toBoundingRect(selection);
    this.inputContainer.style.left = rect.left + 'px';
    this.inputContainer.style.top = rect.top + 'px';
    this.cellInput.innerText = withoutValue
      ? ''
      : await this.sheet!.toInputString(selection);

    this.paintCellInput();
    if (!withoutFocus) {
      setTextRange(this.cellInput, {
        start: this.cellInput.innerText.length,
        end: this.cellInput.innerText.length,
      });
      this.cellInput.focus();
    }
  }

  /**
   * `hideCellInput` hides the cell input.
   */
  private hideCellInput() {
    this.inputContainer.style.left = '-1000px';
    this.cellInput.innerText = '';
    this.cellInput.blur();
  }

  /**
   * `isValidCellInput` checks if the key is a valid cell input.
   */
  private isValidCellInput(key: string): boolean {
    return /^[a-zA-Z0-9 =-]$/.test(key);
  }

  /**
   * `isCellInputFocused` checks if the cell input is focused.
   */
  private isCellInputFocused(): boolean {
    return document.activeElement === this.cellInput;
  }

  /**
   * `toRef` returns the Ref for the given x and y coordinates.
   */
  private toRef(x: number, y: number): Ref {
    const row = Math.floor(y / DefaultCellHeight);
    const col = Math.floor((x + RowHeaderWidth) / DefaultCellWidth);
    return { r: row, c: col };
  }

  /**
   * `toBoundingRect` returns the bounding rectangle for the given Ref.
   */
  private toBoundingRect(id: Ref, absolute: boolean = false): BoundingRect {
    const scroll = this.scroll;
    return {
      left:
        (id.c - 1) * DefaultCellWidth +
        RowHeaderWidth -
        (absolute ? 0 : scroll.left),
      top:
        (id.r - 1) * DefaultCellHeight +
        DefaultCellHeight -
        (absolute ? 0 : scroll.top),
      width: DefaultCellWidth,
      height: DefaultCellHeight,
    };
  }

  /**
   * `expandBoundingRect` expands the bounding rectangle to include the end cell.
   */
  private expandBoundingRect(
    start: BoundingRect,
    end: BoundingRect,
  ): BoundingRect {
    return {
      left: Math.min(start.left, end.left),
      top: Math.min(start.top, end.top),
      width: Math.abs(start.left - end.left) + DefaultCellWidth,
      height: Math.abs(start.top - end.top) + DefaultCellHeight,
    };
  }

  /**
   * `paintFormulaBar` paints the formula bar.
   */
  private async paintFormulaBar() {
    const ref = this.sheet!.getActiveCell();
    this.cellLabel.textContent = toSref(ref);
    this.formulaInput.value = await this.sheet!.toInputString(ref);
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
   * `paintOverlay` paints the overlay.
   */
  private paintOverlay() {
    this.overlayCanvas.width = 0;
    this.overlayCanvas.height = 0;

    const ctx = this.overlayCanvas.getContext('2d')!;
    const ratio = window.devicePixelRatio || 1;
    const viewport = this.viewport;

    this.overlayCanvas.width = viewport.width * ratio;
    this.overlayCanvas.height = viewport.height * ratio;
    this.overlayCanvas.style.width = viewport.width + 'px';
    this.overlayCanvas.style.height = viewport.height + 'px';
    ctx.scale(ratio, ratio);

    const selection = this.sheet!.getActiveCell();
    const rect = this.toBoundingRect(selection);

    ctx.strokeStyle = this.getThemeColor('activeCellColor');
    ctx.lineWidth = 2;
    ctx.strokeRect(rect.left, rect.top, rect.width, rect.height);

    const range = this.sheet!.getRange();
    if (range) {
      const rect = this.expandBoundingRect(
        this.toBoundingRect(range[0]),
        this.toBoundingRect(range[1]),
      );

      ctx.fillStyle = this.getThemeColor('selectionBGColor');
      ctx.fillRect(rect.left, rect.top, rect.width, rect.height);
      ctx.strokeStyle = this.getThemeColor('activeCellColor');
      ctx.lineWidth = 1;
      ctx.strokeRect(rect.left, rect.top, rect.width, rect.height);
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
    const rect = this.toBoundingRect(id);

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

  private paintCellInput() {
    const text = this.cellInput.innerText;
    if (!text.startsWith('=')) {
      return;
    }

    const tokens = extractTokens(text);
    const filledTokens: Array<Token> = [];
    let prevToken: Token | null = null;
    for (const token of tokens) {
      if (token.type === 'EOF') {
        break;
      }

      const prevStop = prevToken ? prevToken.stop : 0;
      const diff = token.start - prevStop;
      if (diff > 1) {
        filledTokens.push({
          type: 'WHITESPACE',
          start: prevStop,
          stop: token.start,
          text: ' '.repeat(diff - 1),
        });
      }
      filledTokens.push(token);

      prevToken = token;
    }

    const contents: Array<string> = [];
    for (const token of filledTokens) {
      if (token.type === 'EOF') {
        break;
      }

      if (TokenColorMap.has(token.type)) {
        contents.push(
          `<span style="color: ${TokenColorMap.get(token.type)}">${token.text}</span>`,
        );
        continue;
      }

      contents.push(escapeHTML(token.text));
    }

    const textRange = toTextRange(this.cellInput);
    this.cellInput.innerHTML = '=' + contents.join('');
    if (textRange) {
      setTextRange(this.cellInput, textRange);
    }
  }
}
