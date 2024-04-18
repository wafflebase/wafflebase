import { toColumnLabel, toRef } from '../sheet/coordinates';
import { Sheet } from '../sheet/sheet';
import { Grid, CellID } from '../sheet/types';
import { MockGrid } from '../sheet/mock';

const CellWidth = 90;
const CellHeight = 22;
const CellBorderWidth = 0.5;
const CellBorderColor = '#d3d3d3';
const CellBGColor = '#ffffff';
const CellTextColor = '#000000';
const ActiveCellColor = '#0000ff';
const HeaderBGColor = '#f0f0f0';
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
    this.container.style.overflow = 'scroll';

    this.topContainer = document.createElement('div');
    this.topContainer.style.position = 'sticky';
    this.topContainer.style.top = '0';
    this.topContainer.style.left = '0';
    this.topContainer.style.height = CellHeight + 'px';
    this.topContainer.style.zIndex = '1';

    this.bottomContainer = document.createElement('div');
    this.bottomContainer.style.position = 'absolute';
    this.bottomContainer.style.overflow = 'auto';
    this.bottomContainer.style.top = CellHeight + 'px';
    this.bottomContainer.style.left = '0';
    this.bottomContainer.style.bottom = '0';
    this.bottomContainer.style.display = 'flex';

    this.bottomLeftContainer = document.createElement('div');
    this.bottomLeftContainer.style.width = RowHeaderWidth + 'px';
    this.bottomLeftContainer.style.height = '100%';
    this.bottomLeftContainer.style.zIndex = '2';

    this.bottomRightContainer = document.createElement('div');
    this.bottomRightContainer.style.flexGrow = '1';

    this.inputContainer = document.createElement('div');
    this.inputContainer.style.position = 'absolute';
    this.inputContainer.style.left = '-1000px';
    this.inputContainer.style.width = CellWidth + 'px';
    this.inputContainer.style.height = CellHeight + 'px';
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

    this.bottomRightContainer.addEventListener('mousedown', (e) => {
      this.sheet.selectStart(this.toCellID(e.offsetX, e.offsetY));
      this.paintGrid();

      const onMove = (e: MouseEvent) => {
        this.sheet.selectEnd(this.toCellID(e.offsetX, e.offsetY));
        this.paintGrid();
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
      this.paintGrid();
    });

    document.addEventListener('keydown', (e) => {
      if (this.isCellInputFocused()) {
        this.handleCellInputKeydown(e);
        return;
      }

      this.handleGridKeydown(e);
    });
  }

  handleCellInputKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      this.sheet.setData(this.sheet.getActiveCell(), this.cellInput.value);
      this.sheet.moveActiveCell(1, 0);
      this.hideCellInput();
      e.preventDefault();
    } else if (e.key === 'Tab') {
      this.sheet.setData(this.sheet.getActiveCell(), this.cellInput.value);
      this.sheet.moveActiveCell(0, 1);
      this.hideCellInput();
      e.preventDefault();
    } else if (e.key === 'Escape') {
      this.hideCellInput();
    }
  }

  handleGridKeydown(e: KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      this.sheet.moveActiveCell(1, 0);
      this.paintGrid();
      e.preventDefault();
    } else if (e.key === 'ArrowUp') {
      this.sheet.moveActiveCell(-1, 0);
      this.paintGrid();
      e.preventDefault();
    } else if (e.key === 'ArrowLeft' || (e.key === 'Tab' && e.shiftKey)) {
      this.sheet.moveActiveCell(0, -1);
      this.paintGrid();
      e.preventDefault();
    } else if (e.key === 'ArrowRight' || e.key === 'Tab') {
      this.sheet.moveActiveCell(0, 1);
      this.paintGrid();
      e.preventDefault();
    } else if (e.key === 'Enter') {
      this.showCellInput();
      this.cellInput.focus();
      e.preventDefault();
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      const selection = this.sheet.getActiveCell();
      if (this.sheet.removeData(selection)) {
        this.paintGrid();
      }
      e.preventDefault();
    } else if (this.isCellInput(e.key)) {
      this.showCellInput(true);
    }
  }

  /**
   * `showCellInput` shows the cell input.
   */
  private showCellInput(withoutValue = false) {
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
    const row = Math.floor(y / CellHeight) + 1;
    const col = Math.floor(x / CellWidth) + 1;
    return { row, col };
  }

  /**
   * `toBoundingRect` returns the bounding rectangle for the given cell index.
   */
  private toBoundingRect(id: CellID, excludeRowHeader = false): BoundingRect {
    return {
      left: (excludeRowHeader ? 0 : RowHeaderWidth) + (id.col - 1) * CellWidth,
      top: (id.row - 1) * CellHeight,
      width: CellWidth,
      height: CellHeight,
    };
  }

  /**
   * `render` renders the spreadsheet in the container.
   */
  public render() {
    this.paintSheet();
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
      (RowHeaderWidth + dimension.columns * CellWidth) * ratio;
    this.columnHeaderCanvas.height = CellHeight * ratio;
    this.columnHeaderCanvas.style.width =
      RowHeaderWidth + dimension.columns * CellWidth + 'px';
    this.columnHeaderCanvas.style.height = CellHeight + 'px';
    ctx.scale(ratio, ratio);

    for (let j = 0; j < dimension.columns; j++) {
      const x = RowHeaderWidth + CellWidth * j;
      const y = 0;
      this.paintHeader(ctx, x, y, CellWidth, toColumnLabel(j + 1));
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
    this.rowHeaderCanvas.height = dimension.rows * CellHeight * ratio;
    this.rowHeaderCanvas.style.width = RowHeaderWidth + 'px';
    this.rowHeaderCanvas.style.height = dimension.rows * CellHeight + 'px';
    ctx.scale(ratio, ratio);

    for (let i = 0; i < dimension.rows; i++) {
      const x = 0;
      const y = i * CellHeight;
      this.paintHeader(ctx, x, y, RowHeaderWidth, (i + 1).toString());
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
    this.gridCanvas.width = dimension.columns * CellWidth * ratio;
    this.gridCanvas.height = dimension.rows * CellHeight * ratio;
    this.gridCanvas.style.width = dimension.columns * CellWidth + 'px';
    this.gridCanvas.style.height = dimension.rows * CellHeight + 'px';
    ctx.scale(ratio, ratio);

    for (let row = 1; row <= dimension.rows + 1; row++) {
      for (let col = 1; col <= dimension.columns + 1; col++) {
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
      const start = this.toBoundingRect(range[0], true);
      const end = this.toBoundingRect(range[1], true);

      ctx.fillStyle = 'rgba(0, 0, 155, 0.1)';
      ctx.fillRect(
        Math.min(start.left, end.left),
        Math.min(start.top, end.top),
        Math.abs(start.left - end.left) + CellWidth,
        Math.abs(start.top - end.top) + CellHeight,
      );
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
  ) {
    ctx.fillStyle = HeaderBGColor;
    ctx.fillRect(x, y, width, CellHeight);
    ctx.strokeStyle = CellBorderColor;
    ctx.lineWidth = CellBorderWidth;
    ctx.strokeRect(x, y, width, CellHeight);
    ctx.fillStyle = CellTextColor;
    ctx.textAlign = HeaderTextAlign;
    ctx.fillText(label, x + width / 2, y + 15);
  }

  /**
   * `paintCell` paints the cell.
   */
  private paintCell(ctx: CanvasRenderingContext2D, id: CellID) {
    const rect = this.toBoundingRect(id, true);
    ctx.strokeStyle = CellTextColor;
    ctx.lineWidth = CellBorderWidth;
    ctx.strokeRect(rect.left, rect.top, CellWidth, CellHeight);
    ctx.fillStyle = CellBGColor;
    ctx.fillRect(rect.left, rect.top, CellWidth, CellHeight);

    const data = this.sheet.toDisplayString(toRef(id));
    if (data != undefined) {
      ctx.fillStyle = CellTextColor;
      ctx.textAlign = 'center';
      ctx.fillText(
        data.toString(),
        rect.left + CellWidth / 2,
        rect.top + 15,
        CellWidth,
      );
    }
  }
}
