import { toColumnLabel } from '../sheet/coordinates';
import { Sheet } from '../sheet/sheet';
import { Grid } from '../sheet/types';
import { MockGrid } from '../sheet/mock';

const CellWidth = 90;
const CellHeight = 20;
const CellBorderWidth = 0.5;
const CellBorderColor = '#d3d3d3';
const CellBGColor = '#ffffff';
const CellTextColor = '#000000';
const ActiveCellColor = '#0000ff';
const HeaderBGColor = '#f0f0f0';
const HeaderTextAlign = 'center';
const RowHeaderWidth = 50;

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
  private topContainer: HTMLDivElement;
  private bottomContainer: HTMLDivElement;
  private bottomLeftContainer: HTMLDivElement;
  private bottomRightContainer: HTMLDivElement;
  private columnHeaderCanvas: HTMLCanvasElement;
  private rowHeaderCanvas: HTMLCanvasElement;
  private gridCanvas: HTMLCanvasElement;

  constructor(container: HTMLDivElement, grid?: Grid) {
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
    this.container.appendChild(this.topContainer);
    this.container.appendChild(this.bottomContainer);

    this.sheet = new Sheet(grid);

    this.container.addEventListener('mousedown', (e) => {
      const x = e.offsetX;
      const y = e.offsetY;

      const row = Math.floor(y / CellHeight) + 1;
      const col = Math.floor(x / CellWidth) + 1;
      this.sheet.setSelection({ row, col });
      this.render();
    });

    window.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') {
        this.sheet.moveSelection(1, 0);
        this.render();
        e.preventDefault();
      } else if (e.key === 'ArrowUp') {
        this.sheet.moveSelection(-1, 0);
        this.render();
        e.preventDefault();
      } else if (e.key === 'ArrowLeft') {
        this.sheet.moveSelection(0, -1);
        this.render();
        e.preventDefault();
      } else if (e.key === 'ArrowRight') {
        this.sheet.moveSelection(0, 1);
        this.render();
        e.preventDefault();
      }
    });
  }

  /**
   * render renders the spreadsheet in the container.
   */
  render() {
    this.paintSheet();
  }

  paintSheet() {
    this.paintColumnHeader();
    this.paintRowHeader();
    this.paintGrid();
    this.paintSelection();
  }

  paintColumnHeader() {
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

  paintRowHeader() {
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

  paintGrid() {
    this.gridCanvas.width = 0;
    this.gridCanvas.height = 0;

    const ctx = this.gridCanvas.getContext('2d')!;
    const dimension = this.sheet.getDimension();

    const ratio = window.devicePixelRatio || 1;
    this.gridCanvas.width = dimension.columns * CellWidth * ratio;
    this.gridCanvas.height = dimension.rows * CellHeight * ratio;
    this.gridCanvas.style.width = dimension.columns * CellWidth + 'px';
    this.gridCanvas.style.height = dimension.rows * CellHeight + 'px';
    ctx.scale(ratio, ratio);

    for (let i = 0; i <= dimension.rows; i++) {
      for (let j = 0; j <= dimension.columns; j++) {
        const x = j * CellWidth;
        const y = i * CellHeight;
        const data = this.sheet.getData(i + 1, j + 1);
        this.paintCell(ctx, x, y, data);
      }
    }
  }

  private paintSelection() {
    const ctx = this.gridCanvas.getContext('2d')!;
    const row = this.sheet.getSelection().row;
    const col = this.sheet.getSelection().col;

    const x = (col - 1) * CellWidth;
    const y = (row - 1) * CellHeight;
    const width = CellWidth;
    const height = CellHeight;

    ctx.strokeStyle = ActiveCellColor;
    ctx.lineWidth = 2;
    ctx.strokeRect(x, y, width, height);
  }

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

  private paintCell(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    data: number | undefined,
  ) {
    ctx.strokeStyle = CellTextColor;
    ctx.lineWidth = CellBorderWidth;
    ctx.strokeRect(x, y, CellWidth, CellHeight);
    ctx.fillStyle = CellBGColor;
    ctx.fillRect(x, y, CellWidth, CellHeight);
    if (data != undefined) {
      ctx.fillStyle = CellTextColor;
      ctx.textAlign = 'center';
      ctx.fillText(data.toString(), x + CellWidth / 2, y + 15);
    }
  }
}
