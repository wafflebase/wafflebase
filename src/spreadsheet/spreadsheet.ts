import { toColumnLabel } from '../sheet/coordinates';
import { Sheet } from '../sheet/sheet';
import { Grid, CellIndex } from '../sheet/types';
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
  private selection: CellIndex;
  private canvas: HTMLCanvasElement;

  constructor(container: HTMLDivElement, grid?: Grid) {
    this.sheet = new Sheet(grid);
    this.selection = { row: 1, col: 1 };
    this.canvas = document.createElement('canvas');
    container.appendChild(this.canvas);

    container.addEventListener('mousedown', (e) => {
      const x = e.offsetX;
      const y = e.offsetY;

      const row = Math.floor(y / CellHeight);
      const col = Math.floor((x - RowHeaderWidth) / CellWidth) + 1;
      this.updateSelection(row, col);
    });

    window.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') {
        this.moveSelection(1, 0);
        e.preventDefault();
      } else if (e.key === 'ArrowUp') {
        this.moveSelection(-1, 0);
        e.preventDefault();
      } else if (e.key === 'ArrowLeft') {
        this.moveSelection(0, -1);
        e.preventDefault();
      } else if (e.key === 'ArrowRight') {
        this.moveSelection(0, 1);
        e.preventDefault();
      }
    });
  }

  /**
   * `moveSelection` moves the selection by the given delta.
   * @param rowDelta Delta to move the selection in the row direction.
   * @param colDelta Delta to move the selection in the column direction.
   */
  private moveSelection(rowDelta: number, colDelta: number) {
    const dimension = this.sheet.getDimension();
    let newRow = this.selection.row + rowDelta;
    let newCol = this.selection.col + colDelta;

    if (newRow < 1) {
      newRow = 1;
    } else if (newRow > dimension.rows) {
      newRow = dimension.rows;
    }

    if (newCol < 1) {
      newCol = 1;
    } else if (newCol > dimension.columns) {
      newCol = dimension.columns;
    }

    this.updateSelection(newRow, newCol);
  }

  private updateSelection(row: number, col: number) {
    if (row < 1 || col < 1) {
      return;
    }

    this.selection = { row, col };
    this.render();
  }

  /**
   * render renders the spreadsheet in the container.
   */
  render() {
    // Clear the canvas before rendering for re-rendering.
    this.canvas.width = 0;
    this.canvas.height = 0;

    this.paintGrid();
    this.paintSelection();
  }

  paintGrid() {
    const ctx = this.canvas.getContext('2d')!;
    const dimension = this.sheet.getDimension();

    const ratio = window.devicePixelRatio || 1;
    this.canvas.width = (dimension.columns + 1) * CellWidth * ratio;
    this.canvas.height = (dimension.rows + 1) * CellHeight * ratio;
    this.canvas.style.width =
      (dimension.columns + 1) * CellWidth + RowHeaderWidth + 'px';
    this.canvas.style.height = (dimension.rows + 1) * CellHeight + 'px';

    ctx.scale(ratio, ratio);

    for (let i = 0; i < dimension.rows; i++) {
      const x = 0;
      const y = (i + 1) * CellHeight;
      this.paintHeader(ctx, x, y, RowHeaderWidth, (i + 1).toString());
    }

    for (let j = 0; j < dimension.columns; j++) {
      const x = RowHeaderWidth + j * CellWidth;
      const y = 0;
      this.paintHeader(ctx, x, y, CellWidth, toColumnLabel(j + 1));
    }

    for (let i = 0; i <= dimension.rows; i++) {
      for (let j = 0; j <= dimension.columns; j++) {
        const x = RowHeaderWidth + j * CellWidth;
        const y = (i + 1) * CellHeight;
        const data = this.sheet.getData(i + 1, j + 1);
        this.paintCell(ctx, x, y, data);
      }
    }
  }

  private paintSelection() {
    const ctx = this.canvas.getContext('2d')!;
    const row = this.selection.row;
    const col = this.selection.col;

    const x = RowHeaderWidth + (col - 1) * CellWidth;
    const y = row * CellHeight;
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
