import { toColumnLabel } from "./model/coordinates";
import { Sheet } from "./model/sheet";
import { Grid } from "./model/types";
import { MockGrid } from "./model/mock";

const CellWidth = 100;
const CellHeight = 20;
const CellBorderWidth = 0.5;
const CellBorderColor = "#d3d3d3";
const CellBGColor = "#ffffff";
const CellTextColor = "#000000";
const RowHeaderWidth = 50;
const HeaderBGColor = "#f0f0f0";
const HeaderTextAlign = "center";

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

  constructor(container: HTMLDivElement, grid?: Grid) {
    this.container = container;
    this.sheet = new Sheet(grid);
  }

  /**
   * render renders the spreadsheet in the container.
   */
  render() {
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d")!;
    const dimension = this.sheet.getDimension();

    const ratio = window.devicePixelRatio || 1;
    canvas.width = (dimension.columns + 1) * CellWidth * ratio;
    canvas.height = (dimension.rows + 1) * CellHeight * ratio;
    canvas.style.width =
      (dimension.columns + 1) * CellWidth + RowHeaderWidth + "px";
    canvas.style.height = (dimension.rows + 1) * CellHeight + "px";

    ctx.scale(ratio, ratio);

    // Paint row headers
    for (let i = 0; i < dimension.rows; i++) {
      const x = 0;
      const y = (i + 1) * CellHeight;
      this.paintHeader(ctx, x, y, RowHeaderWidth, (i + 1).toString());
    }

    // Paint column headers
    for (let j = 0; j < dimension.columns; j++) {
      const x = RowHeaderWidth + j * CellWidth;
      const y = 0;
      this.paintHeader(ctx, x, y, CellWidth, toColumnLabel(j + 1));
    }

    // Paint cells
    for (let i = 0; i <= dimension.rows; i++) {
      for (let j = 0; j <= dimension.columns; j++) {
        const x = RowHeaderWidth + j * CellWidth;
        const y = (i + 1) * CellHeight;
        const data = this.sheet.getData(i + 1, j + 1);
        this.paintCell(ctx, x, y, data);
      }
    }

    this.container.appendChild(canvas);
  }

  private paintHeader(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    width: number,
    label: string
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
    data: number | undefined
  ) {
    ctx.strokeStyle = CellTextColor;
    ctx.lineWidth = CellBorderWidth;
    ctx.strokeRect(x, y, CellWidth, CellHeight);
    ctx.fillStyle = CellBGColor;
    ctx.fillRect(x, y, CellWidth, CellHeight);
    if (data != undefined) {
      ctx.fillStyle = CellTextColor;
      ctx.textAlign = "center";
      ctx.fillText(data.toString(), x + CellWidth / 2, y + 15);
    }
  }
}
