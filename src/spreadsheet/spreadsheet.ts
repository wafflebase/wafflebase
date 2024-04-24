import { toColumnLabel, toRef } from '../sheet/coordinates';
import { Sheet } from '../sheet/sheet';
import { Grid, CellID, CellRange } from '../sheet/types';
import { MockGrid } from '../sheet/mock';

const DefaultCellWidth = 100;
const DefaultCellHeight = 23;
const CellBorderWidth = 0.5;
const CellBorderColor = '#D3D3D3';
const CellBGColor = '#FFFFFF';
const CellTextColor = '#000000';
const ActiveCellColor = '#FFD580';
const SelectionBGColor = 'rgba(255, 213, 128, 0.1)';
const HeaderBGColor = '#F0F0F0';
const HeaderActiveBGColor = '#FFD580';
const HeaderTextAlign = 'center';
const RowHeaderWidth = 50;

/**
 * BoundingRect represents the bounding rectangle of a cell.
 * TODO(hackerwins): We need to use `BigInt` for the coordinates
 * and `number` for the width and height. Because the coordinates
 * can be very large for big dimensions of the grid.
 */
type BoundingRect = {
  left: number;
  top: number;
  width: number;
  height: number;
};

/**
 * Size represents the size of the rectangle.
 * TODO(hackerwins): We need to use `BigInt` for the coordinates
 * and `number` for the width and height. Because the coordinates
 * can be very large for big dimensions of the grid.
 */
type Size = {
  width: number;
  height: number;
};

/**
 * setupSpreadsheet sets up the spreadsheet in the given container.
 * @param container Container element to render the spreadsheet.
 */
export function setupSpreadsheet(container: HTMLDivElement) {
  const spreadsheet = new Spreadsheet(container, new Map(MockGrid));
  spreadsheet.render();
}
/**
 * Spreadsheet is a class that represents a spreadsheet.
 */
class Spreadsheet {
  private sheet: Sheet;

  private container: HTMLDivElement;
  private formulaBar: HTMLDivElement;
  private cellLabel: HTMLDivElement;
  private formulaInput: HTMLInputElement;
  private sheetContainer: HTMLDivElement;
  private scrollContainer: HTMLDivElement;
  private dummyContainer: HTMLDivElement;
  private inputContainer: HTMLDivElement;
  private cellInput: HTMLInputElement;
  private gridCanvas: HTMLCanvasElement;
  private overlayCanvas: HTMLCanvasElement;

  /**
   * `constructor` initializes the spreadsheet with the given grid.
   */
  constructor(container: HTMLDivElement, grid?: Grid) {
    this.sheet = new Sheet(grid);

    this.container = container;
    this.formulaBar = document.createElement('div');
    this.formulaBar.style.height = `${DefaultCellHeight}px`;
    this.formulaBar.style.margin = '10px 0px';
    this.formulaBar.style.display = 'flex';
    this.formulaBar.style.alignItems = 'center';
    this.formulaBar.style.borderTop = `1px solid ${CellBorderColor}`;
    this.formulaBar.style.borderBottom = `1px solid ${CellBorderColor}`;
    this.formulaBar.style.justifyContent = 'flex-start';

    this.cellLabel = document.createElement('div');
    this.cellLabel.style.width = '100px';
    this.cellLabel.style.textAlign = 'center';
    this.cellLabel.style.font = '12px Arial';
    this.cellLabel.style.borderRight = `1px solid ${CellBorderColor}`;
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
    this.sheetContainer.style.height = '100%';

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

    this.cellInput = document.createElement('input');
    this.cellInput.style.width = '100%';
    this.cellInput.style.height = '100%';
    this.cellInput.style.border = 'none';
    this.cellInput.style.outline = `2px solid ${ActiveCellColor}`;
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

    this.addEventLisnters();
  }

  /**
   * `render` renders the spreadsheet in the container.
   */
  public render() {
    this.paintFormulaBar();
    this.paintSheet();
    this.paintOverlay();
  }

  /**
   * `finishEditing` finishes the editing of the cell.
   */
  private finishEditing() {
    if (this.isFormulaInputFocused()) {
      this.sheet.setData(this.sheet.getActiveCell(), this.formulaInput.value);
      this.formulaInput.blur();
      this.hideCellInput();
    } else if (this.isCellInputFocused()) {
      this.sheet.setData(this.sheet.getActiveCell(), this.cellInput.value);
      this.cellInput.blur();
      this.hideCellInput();
    }
  }

  /**
   * `addEventLisnters` adds event listeners to the spreadsheet.
   */
  private addEventLisnters() {
    window.addEventListener('resize', () => {
      this.render();
    });
    this.scrollContainer.addEventListener('scroll', () => {
      this.render();
    });

    this.scrollContainer.addEventListener('mousedown', (e) => {
      this.finishEditing();
      this.sheet.selectStart(this.toCellID(e.offsetX, e.offsetY));
      this.render();

      const onMove = (e: MouseEvent) => {
        this.sheet.selectEnd(this.toCellID(e.offsetX, e.offsetY));
        this.render();
      };
      const onUp = () => {
        this.scrollContainer.removeEventListener('mousemove', onMove);
        this.scrollContainer.removeEventListener('mouseup', onUp);
      };

      this.scrollContainer.addEventListener('mousemove', onMove);
      this.scrollContainer.addEventListener('mouseup', onUp);
    });

    this.scrollContainer.addEventListener('dblclick', (e) => {
      this.showCellInput();
      this.cellInput.focus();
      e.preventDefault();
    });

    document.addEventListener('keydown', (e) => {
      if (this.isFormulaInputFocused()) {
        this.handleFormulaInputKeydown(e);
        return;
      } else if (this.isCellInputFocused()) {
        this.handleCellInputKeydown(e);
        return;
      }

      this.handleGridKeydown(e);
    });

    document.addEventListener('keyup', () => {
      if (this.isFormulaInputFocused()) {
        this.cellInput.value = this.formulaInput.value;
        return;
      } else if (this.isCellInputFocused()) {
        this.formulaInput.value = this.cellInput.value;
        return;
      }
    });
  }

  /**
   * `isFormulaInputFocused` checks if the formula input is focused.
   */
  private isFormulaInputFocused(): boolean {
    return document.activeElement === this.formulaInput;
  }

  /**
   * `handleFormulaInputKeydown` handles the keydown event for the formula input.
   */
  private handleFormulaInputKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      this.finishEditing();
      this.sheet.move(1, 0);
      this.scrollIntoView();
      e.preventDefault();
    } else if (e.key === 'Escape') {
      this.formulaInput.value = this.sheet.toInputString(
        toRef(this.sheet.getActiveCell()),
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
  private handleCellInputKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      this.finishEditing();
      this.sheet.moveInRange(e.shiftKey ? -1 : 1, 0);
      this.render();
      this.scrollIntoView();
      e.preventDefault();
    } else if (e.key === 'Tab') {
      this.finishEditing();
      this.sheet.moveInRange(0, e.shiftKey ? -1 : 1);
      this.render();
      this.scrollIntoView();
      e.preventDefault();
    } else if (e.key.startsWith('Arrow') && !this.hasFormulaInCellInput()) {
      this.finishEditing();

      if (e.key === 'ArrowDown') {
        this.sheet.move(1, 0);
      } else if (e.key === 'ArrowUp') {
        this.sheet.move(-1, 0);
      } else if (e.key === 'ArrowLeft') {
        this.sheet.move(0, -1);
      } else if (e.key === 'ArrowRight') {
        this.sheet.move(0, 1);
      }

      this.render();
      this.scrollIntoView();
      e.preventDefault();
    } else if (e.key === 'Escape') {
      this.hideCellInput();
    }
  }

  /**
   * `handleGridKeydown` handles the keydown event for the grid.
   */
  private handleGridKeydown(e: KeyboardEvent) {
    const move = (row: number, col: number, shift: boolean, ctrl: boolean) => {
      let changed = shift
        ? this.sheet.resizeRange(row, col)
        : ctrl
          ? this.sheet.moveToEdge(row, col)
          : this.sheet.move(row, col);
      if (changed) {
        this.render();
        this.scrollIntoView();
      }
      e.preventDefault();
    };

    if (e.key === 'ArrowDown') {
      move(1, 0, e.shiftKey, e.metaKey);
    } else if (e.key === 'ArrowUp') {
      move(-1, 0, e.shiftKey, e.metaKey);
    } else if (e.key === 'ArrowLeft') {
      move(0, -1, e.shiftKey, e.metaKey);
    } else if (e.key === 'ArrowRight') {
      move(0, 1, e.shiftKey, e.metaKey);
    }

    if (e.key === 'Tab') {
      this.sheet.moveInRange(0, e.shiftKey ? -1 : 1);
      this.render();
      this.scrollIntoView();
      e.preventDefault();
    } else if (e.key === 'Enter') {
      if (this.sheet.hasRange()) {
        this.sheet.moveInRange(e.shiftKey ? -1 : 1, 0);
        this.render();
        this.scrollIntoView();
      } else {
        this.showCellInput();
        this.cellInput.focus();
      }
      e.preventDefault();
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      if (this.sheet.removeData()) {
        this.render();
      }
      e.preventDefault();
    } else if (!e.metaKey && !e.ctrlKey && this.isValidCellInput(e.key)) {
      this.showCellInput(true);
    }
  }

  /**
   * `viewRange` returns the visible range of the grid.
   */
  private get viewRange(): CellRange {
    const scrollTop = this.scrollContainer.scrollTop;
    const scrollLeft = this.scrollContainer.scrollLeft;

    const startRow = Math.floor(scrollTop / DefaultCellHeight) + 1;
    const endRow =
      Math.ceil(
        (scrollTop + this.scrollContainer.clientHeight) / DefaultCellHeight,
      ) + 1;
    const startCol = Math.floor(scrollLeft / DefaultCellWidth) + 1;
    const endCol =
      Math.ceil(
        (scrollLeft + this.scrollContainer.clientWidth) / DefaultCellWidth,
      ) + 1;

    return [
      { row: startRow, col: startCol },
      { row: endRow, col: endCol },
    ];
  }

  /**
   * `scrollIntoView` scrolls the active cell into view.
   */
  private scrollIntoView(id: CellID = this.sheet.getActiveCell()) {
    const scrollSize = this.scrollSize;
    const cell = this.toBoundingRect(id, true);
    const view = {
      left: scrollSize.width + RowHeaderWidth,
      top: scrollSize.height + DefaultCellHeight,
      width: this.viewportSize.width - RowHeaderWidth,
      height: this.viewportSize.height - DefaultCellHeight,
    };

    let changed = false;
    if (cell.left < view.left) {
      this.scrollContainer.scrollLeft = cell.left - RowHeaderWidth;
      changed = true;
    } else if (cell.left + cell.width > view.left + view.width) {
      this.scrollContainer.scrollLeft =
        cell.left + cell.width - view.width - RowHeaderWidth;
      changed = true;
    }

    if (cell.top < view.top) {
      this.scrollContainer.scrollTop = cell.top - DefaultCellHeight;
      changed = true;
    } else if (cell.top + cell.height > view.top + view.height) {
      this.scrollContainer.scrollTop =
        cell.top + cell.height - view.height - DefaultCellHeight;
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
    return this.cellInput.value.startsWith('=');
  }

  /**
   * `showCellInput` shows the cell input.
   */
  private showCellInput(
    withoutValue: boolean = false,
    withoutFocus: boolean = false,
  ) {
    const selection = this.sheet.getActiveCell();
    const rect = this.toBoundingRect(selection);
    this.inputContainer.style.left = rect.left + 'px';
    this.inputContainer.style.top = rect.top + 'px';
    this.cellInput.value = withoutValue
      ? ''
      : this.sheet.toInputString(toRef(selection));

    if (!withoutFocus) {
      this.cellInput.focus();
    }
  }

  /**
   * `hideCellInput` hides the cell input.
   */
  private hideCellInput() {
    this.inputContainer.style.left = '-1000px';
    this.cellInput.value = '';
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
   * `toCellID` returns the cell ID for the given x and y coordinates.
   */
  private toCellID(x: number, y: number): CellID {
    const row = Math.floor(y / DefaultCellHeight);
    const col = Math.floor((x + RowHeaderWidth) / DefaultCellWidth);
    return { row, col };
  }

  /**
   * `toBoundingRect` returns the bounding rectangle for the given cell index.
   */
  private toBoundingRect(id: CellID, absolute: boolean = false): BoundingRect {
    const scrollSize = this.scrollSize;
    return {
      left:
        (id.col - 1) * DefaultCellWidth +
        RowHeaderWidth -
        (absolute ? 0 : scrollSize.width),
      top:
        (id.row - 1) * DefaultCellHeight +
        DefaultCellHeight -
        (absolute ? 0 : scrollSize.height),
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
  private paintFormulaBar() {
    const id = this.sheet.getActiveCell();
    this.cellLabel.textContent = toRef(id);
    this.formulaInput.value = this.sheet.toInputString(toRef(id));
  }

  /**
   * `paintSheet` paints the spreadsheet.
   */
  private paintSheet() {
    this.paintDummy();
    this.paintGrid();
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
  private paintGrid() {
    this.gridCanvas.width = 0;
    this.gridCanvas.height = 0;

    const ctx = this.gridCanvas.getContext('2d')!;
    const ratio = window.devicePixelRatio || 1;
    const viewportSize = this.viewportSize;
    const scrollSize = this.scrollSize;

    this.gridCanvas.width = viewportSize.width * ratio;
    this.gridCanvas.height = viewportSize.height * ratio;
    this.gridCanvas.style.width = viewportSize.width + 'px';
    this.gridCanvas.style.height = viewportSize.height + 'px';
    ctx.scale(ratio, ratio);

    const [startID, endID] = this.viewRange;
    const id = this.sheet.getActiveCell();

    // Paint cells
    for (let row = startID.row; row <= endID.row + 1; row++) {
      for (let col = startID.col; col <= endID.col + 1; col++) {
        this.paintCell(ctx, { row, col });
      }
    }

    // Paint column header
    for (let col = startID.col; col <= endID.col; col++) {
      const x =
        RowHeaderWidth + DefaultCellWidth * (col - 1) - scrollSize.width;
      const y = 0;
      this.paintHeader(
        ctx,
        x,
        y,
        DefaultCellWidth,
        toColumnLabel(col),
        id.col === col,
      );
    }

    // Paint row header
    for (let row = startID.row; row <= endID.row; row++) {
      const x = 0;
      const y = row * DefaultCellHeight - scrollSize.height;
      this.paintHeader(ctx, x, y, RowHeaderWidth, String(row), id.row === row);
    }
  }

  private get gridSize(): Size {
    const dimension = this.sheet.getDimension();
    return {
      width: dimension.columns * DefaultCellWidth,
      height: dimension.rows * DefaultCellHeight,
    };
  }

  private get viewportSize(): Size {
    return {
      width: this.scrollContainer.clientWidth,
      height: this.scrollContainer.clientHeight,
    };
  }
  private get scrollSize(): Size {
    return {
      width: this.scrollContainer.scrollLeft,
      height: this.scrollContainer.scrollTop,
    };
  }

  /**
   * `paintOverlay` paints the overlay.
   */
  private paintOverlay() {
    this.overlayCanvas.width = 0;
    this.overlayCanvas.height = 0;

    const ctx = this.overlayCanvas.getContext('2d')!;
    const ratio = window.devicePixelRatio || 1;
    const viewportSize = this.viewportSize;

    this.overlayCanvas.width = viewportSize.width * ratio;
    this.overlayCanvas.height = viewportSize.height * ratio;
    this.overlayCanvas.style.width = viewportSize.width + 'px';
    this.overlayCanvas.style.height = viewportSize.height + 'px';
    ctx.scale(ratio, ratio);

    const selection = this.sheet.getActiveCell();
    const rect = this.toBoundingRect(selection);

    ctx.strokeStyle = ActiveCellColor;
    ctx.lineWidth = 2;
    ctx.strokeRect(rect.left, rect.top, rect.width, rect.height);

    const range = this.sheet.getRange();
    if (range) {
      const rect = this.expandBoundingRect(
        this.toBoundingRect(range[0]),
        this.toBoundingRect(range[1]),
      );

      ctx.fillStyle = SelectionBGColor;
      ctx.fillRect(rect.left, rect.top, rect.width, rect.height);
      ctx.strokeStyle = ActiveCellColor;
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
    ctx.fillStyle = selected ? HeaderActiveBGColor : HeaderBGColor;
    ctx.fillRect(x, y, width, DefaultCellHeight);
    ctx.strokeStyle = CellBorderColor;
    ctx.lineWidth = CellBorderWidth;
    ctx.strokeRect(x, y, width, DefaultCellHeight);
    ctx.fillStyle = CellTextColor;
    ctx.textAlign = HeaderTextAlign;
    ctx.font = selected ? 'bold 10px Arial' : '10px Arial';
    ctx.fillText(label, x + width / 2, y + 15);
  }

  /**
   * `paintCell` paints the cell.
   */
  private paintCell(ctx: CanvasRenderingContext2D, id: CellID) {
    const rect = this.toBoundingRect(id);

    ctx.strokeStyle = CellTextColor;
    ctx.lineWidth = CellBorderWidth;
    ctx.strokeRect(rect.left, rect.top, DefaultCellWidth, DefaultCellHeight);
    ctx.fillStyle = CellBGColor;
    ctx.fillRect(rect.left, rect.top, DefaultCellWidth, DefaultCellHeight);

    const data = this.sheet.toDisplayString(toRef(id));
    if (data) {
      ctx.fillStyle = CellTextColor;
      ctx.textAlign = 'center';
      ctx.font = '12px Arial';
      ctx.fillText(
        data,
        rect.left + DefaultCellWidth / 2,
        rect.top + 15,
        DefaultCellWidth,
      );
    }
  }
}
