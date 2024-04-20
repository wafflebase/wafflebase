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
 */
type BoundingRect = {
  left: number;
  top: number;
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
 *
 * Container Layout:
 *
 * +----------------------------------------+
 * |            Top Container               |
 * +----------------------------------------+
 * |            Bottom Container            |
 * | +------------------+-----------------+ |
 * | | Bottom Left      | Bottom Right    | |
 * | | Container        | Container       | |
 * | +------------------+-----------------+ |
 * |            Input Container             |
 * +----------------------------------------+
 *
 * The spreadsheet is rendered inside a container element.
 * The container is divided into two main sections: top container and bottom container.
 *
 * - The top container is sticky and contains the column header.
 * - The bottom container is divided into two sub-containers: bottom left container and bottom right container.
 * - The bottom left container contains the row header.
 * - The bottom right container contains the grid.
 * - The input container is used to display the cell input and is positioned outside the visible area.
 *
 * TODO(hackerwins): We need to implement the following features:
 * - `freezePane`: Freeze the pane at the given cell index.
 * - `autoScroll`: Automatically scroll the grid when the selection is outside the visible area.
 */
class Spreadsheet {
  private sheet: Sheet;

  private container: HTMLDivElement;
  private topContainer: HTMLDivElement;
  private bottomContainer: HTMLDivElement;
  private bottomLeftContainer: HTMLDivElement;
  private bottomRightContainer: HTMLDivElement;
  private inputContainer: HTMLDivElement;
  private cellInput: HTMLInputElement;
  private columnHeaderCanvas: HTMLCanvasElement;
  private rowHeaderCanvas: HTMLCanvasElement;
  private gridCanvas: HTMLCanvasElement;

  constructor(container: HTMLDivElement, grid?: Grid) {
    this.sheet = new Sheet(grid);

    this.container = container;
    this.container.style.position = 'relative';
    this.container.style.overflowY = 'scroll';

    this.topContainer = document.createElement('div');
    this.topContainer.style.position = 'sticky';
    this.topContainer.style.top = '0';
    this.topContainer.style.height = DefaultCellHeight + 'px';
    this.topContainer.style.zIndex = '1';
    this.topContainer.style.overflowX = 'scroll';
    this.topContainer.style.scrollbarWidth = 'none';

    this.bottomContainer = document.createElement('div');
    this.bottomContainer.style.position = 'relative';
    this.bottomContainer.style.overflowX = 'scroll';
    this.bottomContainer.style.left = '0';
    this.bottomContainer.style.bottom = '0';
    this.bottomContainer.style.display = 'flex';

    this.bottomLeftContainer = document.createElement('div');
    this.bottomLeftContainer.style.position = 'sticky';
    this.bottomLeftContainer.style.left = '0';
    this.bottomLeftContainer.style.width = RowHeaderWidth + 'px';
    this.bottomLeftContainer.style.height = '100%';
    this.bottomLeftContainer.style.zIndex = '2';

    this.bottomRightContainer = document.createElement('div');
    this.bottomRightContainer.style.flexGrow = '1';

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
    this.inputContainer.appendChild(this.cellInput);

    this.columnHeaderCanvas = this.topContainer.appendChild(
      document.createElement('canvas'),
    );
    this.rowHeaderCanvas = this.bottomLeftContainer.appendChild(
      document.createElement('canvas'),
    );
    this.gridCanvas = this.bottomRightContainer.appendChild(
      document.createElement('canvas'),
    );

    this.bottomContainer.appendChild(this.bottomLeftContainer);
    this.bottomContainer.appendChild(this.bottomRightContainer);
    this.bottomContainer.appendChild(this.inputContainer);
    this.container.appendChild(this.topContainer);
    this.container.appendChild(this.bottomContainer);

    this.addEventLisnters();
  }

  /**
   * `render` renders the spreadsheet in the container.
   */
  public render() {
    this.paintSheet();
  }

  /**
   * `addEventLisnters` adds event listeners to the spreadsheet.
   */
  private addEventLisnters() {
    window.addEventListener('resize', () => {
      this.render();
    });
    this.container.addEventListener('scroll', () => {
      this.render();
    });
    this.bottomContainer.addEventListener('scroll', () => {
      this.topContainer.scrollLeft = this.bottomContainer.scrollLeft;
      this.render();
    });

    this.bottomRightContainer.addEventListener('mousedown', (e) => {
      this.sheet.selectStart(this.toCellID(e.offsetX, e.offsetY));
      this.render();

      const onMove = (e: MouseEvent) => {
        this.sheet.selectEnd(this.toCellID(e.offsetX, e.offsetY));
        this.render();
      };
      const onUp = () => {
        this.bottomRightContainer.removeEventListener('mousemove', onMove);
        this.bottomRightContainer.removeEventListener('mouseup', onUp);
      };

      this.bottomRightContainer.addEventListener('mousemove', onMove);
      this.bottomRightContainer.addEventListener('mouseup', onUp);
    });

    this.bottomRightContainer.addEventListener('dblclick', (e) => {
      this.showCellInput();
      this.cellInput.focus();
      e.preventDefault();
    });

    this.cellInput.addEventListener('blur', () => {
      this.hideCellInput();
      this.render();
    });

    document.addEventListener('keydown', (e) => {
      if (this.isCellInputFocused()) {
        this.handleCellInputKeydown(e);
        return;
      }

      this.handleGridKeydown(e);
    });
  }

  private handleCellInputKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      this.sheet.setData(this.sheet.getActiveCell(), this.cellInput.value);
      this.sheet.move(1, 0);
      this.hideCellInput();
      this.scrollIntoView();
      e.preventDefault();
    } else if (e.key === 'Tab') {
      this.sheet.setData(this.sheet.getActiveCell(), this.cellInput.value);
      this.sheet.move(0, 1);
      this.hideCellInput();
      e.preventDefault();
    } else if (e.key === 'Escape') {
      this.hideCellInput();
    }
  }

  private handleGridKeydown(e: KeyboardEvent) {
    const move = (row: number, col: number, shift: boolean, ctrl: boolean) => {
      let changed = shift
        ? this.sheet.resizeRange(row, col)
        : ctrl
          ? this.sheet.moveToEdge(row, col)
          : this.sheet.move(row, col);
      if (changed) {
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
      this.scrollIntoView();
      e.preventDefault();
    } else if (e.key === 'Enter') {
      if (this.sheet.hasRange()) {
        this.sheet.moveInRange(e.shiftKey ? -1 : 1, 0);
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
    } else if (!e.metaKey && !e.ctrlKey && this.isCellInput(e.key)) {
      this.showCellInput(true);
    }
  }

  /**
   * `viewRange` returns the visible range of the grid.
   */
  private viewRange(): CellRange {
    const scrollTop = this.container.scrollTop;
    const scrollLeft = this.bottomContainer.scrollLeft;

    const startRow = Math.floor(scrollTop / DefaultCellHeight) + 1;
    const endRow =
      Math.ceil((scrollTop + this.container.clientHeight) / DefaultCellHeight) +
      1;
    const startCol = Math.floor(scrollLeft / DefaultCellWidth) + 1;
    const endCol =
      Math.ceil((scrollLeft + this.container.clientWidth) / DefaultCellWidth) +
      1;

    return [
      { row: startRow, col: startCol },
      { row: endRow, col: endCol },
    ];
  }

  /**
   * `scrollIntoView` scrolls the active cell into view.
   */
  private scrollIntoView(id: CellID = this.sheet.getActiveCell()) {
    const cell = this.toBoundingRect(id);
    const view = {
      left: this.bottomContainer.scrollLeft + RowHeaderWidth,
      top: this.container.scrollTop,
      right: this.bottomContainer.scrollLeft + this.bottomContainer.offsetWidth,
      bottom: this.container.scrollTop + this.container.offsetHeight,
    };

    if (cell.left < view.left || cell.left + cell.width > view.right) {
      this.bottomContainer.scrollLeft = cell.left - RowHeaderWidth;
    }

    if (cell.top < view.top || cell.top + cell.height > view.bottom) {
      this.container.scrollTop = cell.top;
    }

    this.render();
  }

  /**
   * `showCellInput` shows the cell input.
   */
  private showCellInput(withoutValue: boolean = false) {
    const selection = this.sheet.getActiveCell();
    const rect = this.toBoundingRect(selection);
    this.inputContainer.style.left = rect.left + 'px';
    this.inputContainer.style.top = rect.top + 'px';
    this.cellInput.value = withoutValue
      ? ''
      : this.sheet.toInputString(toRef(selection));
    this.cellInput.focus();
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
   * `isCellInput` checks if the key is a valid cell input.
   */
  private isCellInput(key: string): boolean {
    return /^[a-zA-Z0-9 =]$/.test(key);
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
    const row = Math.floor(y / DefaultCellHeight) + 1;
    const col = Math.floor(x / DefaultCellWidth) + 1;
    return { row, col };
  }

  /**
   * `toBoundingRect` returns the bounding rectangle for the given cell index.
   */
  private toBoundingRect(id: CellID, excludeRowHeader = false): BoundingRect {
    return {
      left:
        (excludeRowHeader ? 0 : RowHeaderWidth) +
        (id.col - 1) * DefaultCellWidth,
      top: (id.row - 1) * DefaultCellHeight,
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
   * `paintSheet` paints the spreadsheet.
   */
  private paintSheet() {
    this.paintColumnHeader();
    this.paintRowHeader();
    this.paintGrid();
  }

  /**
   * `paintColumnHeader` paints the column header.
   */
  private paintColumnHeader() {
    const ctx = this.columnHeaderCanvas.getContext('2d')!;
    const dimension = this.sheet.getDimension();

    const ratio = window.devicePixelRatio || 1;
    this.columnHeaderCanvas.width =
      (RowHeaderWidth + dimension.columns * DefaultCellWidth) * ratio;
    this.columnHeaderCanvas.height = DefaultCellHeight * ratio;
    this.columnHeaderCanvas.style.width =
      RowHeaderWidth + dimension.columns * DefaultCellWidth + 'px';
    this.columnHeaderCanvas.style.height = DefaultCellHeight + 'px';
    ctx.scale(ratio, ratio);

    const [startID, endID] = this.viewRange();
    const id = this.sheet.getActiveCell();
    for (let col = startID.col; col <= endID.col; col++) {
      const x = RowHeaderWidth + DefaultCellWidth * (col - 1);
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
  }

  /**
   * `paintRowHeader` paints the row header.
   */
  private paintRowHeader() {
    const ctx = this.rowHeaderCanvas.getContext('2d')!;
    const dimension = this.sheet.getDimension();

    const ratio = window.devicePixelRatio || 1;
    this.rowHeaderCanvas.width = RowHeaderWidth * ratio;
    this.rowHeaderCanvas.height = dimension.rows * DefaultCellHeight * ratio;
    this.rowHeaderCanvas.style.width = RowHeaderWidth + 'px';
    this.rowHeaderCanvas.style.height =
      dimension.rows * DefaultCellHeight + 'px';
    ctx.scale(ratio, ratio);

    const [startID, endID] = this.viewRange();
    const id = this.sheet.getActiveCell();
    for (let row = startID.row; row <= endID.row; row++) {
      const x = 0;
      const y = (row - 1) * DefaultCellHeight;
      this.paintHeader(ctx, x, y, RowHeaderWidth, String(row), id.row === row);
    }
  }

  /**
   * `paintGrid` paints the grid.
   */
  private paintGrid() {
    this.gridCanvas.width = 0;
    this.gridCanvas.height = 0;

    const dimension = this.sheet.getDimension();

    const ctx = this.gridCanvas.getContext('2d')!;
    const ratio = window.devicePixelRatio || 1;
    this.gridCanvas.width = dimension.columns * DefaultCellWidth * ratio;
    this.gridCanvas.height = dimension.rows * DefaultCellHeight * ratio;
    this.gridCanvas.style.width = dimension.columns * DefaultCellWidth + 'px';
    this.gridCanvas.style.height = dimension.rows * DefaultCellHeight + 'px';
    ctx.scale(ratio, ratio);

    const [startID, endID] = this.viewRange();
    for (let row = startID.row; row <= endID.row + 1; row++) {
      for (let col = startID.col; col <= endID.col + 1; col++) {
        this.paintCell(ctx, { row, col });
      }
    }

    this.paintSelection();
  }

  /**
   * `paintSelection` paints the selection.
   */
  private paintSelection() {
    const ctx = this.gridCanvas.getContext('2d')!;
    const selection = this.sheet.getActiveCell();
    const rect = this.toBoundingRect(selection, true);

    ctx.strokeStyle = ActiveCellColor;
    ctx.lineWidth = 2;
    ctx.strokeRect(rect.left, rect.top, rect.width, rect.height);

    const range = this.sheet.getRange();
    if (range) {
      const rect = this.expandBoundingRect(
        this.toBoundingRect(range[0], true),
        this.toBoundingRect(range[1], true),
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
    const rect = this.toBoundingRect(id, true);
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
