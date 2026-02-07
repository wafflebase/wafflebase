import { Grid, Cell, Ref, Range, SelectionType } from '../model/types';
import { DimensionIndex } from '../model/dimensions';
import { Theme, ThemeKey, getThemeColor } from './theme';
import { toColumnLabel, toSref } from '../model/coordinates';
import {
  DefaultCellWidth,
  DefaultCellHeight,
  RowHeaderWidth,
  CellBorderWidth,
  HeaderTextAlign,
  BoundingRect,
  Position,
  toBoundingRect,
} from './layout';

/**
 * GridCanvas handles the rendering of the spreadsheet grid on a canvas element.
 */
export class GridCanvas {
  private canvas: HTMLCanvasElement;
  private theme: Theme;

  constructor(theme: Theme = 'light') {
    this.theme = theme;
    this.canvas = document.createElement('canvas');
    this.canvas.style.position = 'absolute';
    this.canvas.style.pointerEvents = 'none';
  }

  public getCanvas(): HTMLCanvasElement {
    return this.canvas;
  }

  public render(
    viewport: BoundingRect,
    scroll: Position,
    viewRange: Range,
    activeCell: Ref,
    grid?: Grid,
    rowDim?: DimensionIndex,
    colDim?: DimensionIndex,
    selectionType?: SelectionType,
    selectionRange?: Range,
  ): void {
    this.canvas.width = 0;
    this.canvas.height = 0;

    const ctx = this.canvas.getContext('2d')!;
    const ratio = window.devicePixelRatio || 1;

    this.canvas.width = viewport.width * ratio;
    this.canvas.height = viewport.height * ratio;
    this.canvas.style.width = viewport.width + 'px';
    this.canvas.style.height = viewport.height + 'px';
    ctx.scale(ratio, ratio);

    const [startID, endID] = viewRange;

    // Render cells
    for (let row = startID.r; row <= endID.r + 1; row++) {
      for (let col = startID.c; col <= endID.c + 1; col++) {
        this.renderCell(
          ctx,
          { r: row, c: col },
          grid?.get(toSref({ r: row, c: col })),
          scroll,
          rowDim,
          colDim,
        );
      }
    }

    // Render column headers
    for (let col = startID.c; col <= endID.c; col++) {
      const colOffset = colDim ? colDim.getOffset(col) : DefaultCellWidth * (col - 1);
      const colWidth = colDim ? colDim.getSize(col) : DefaultCellWidth;
      const x = RowHeaderWidth + colOffset - scroll.left;
      const y = 0;
      const isColSelected = selectionType === 'all' || (selectionType === 'column' && selectionRange &&
        col >= selectionRange[0].c && col <= selectionRange[1].c);
      this.renderHeader(
        ctx,
        x,
        y,
        colWidth,
        DefaultCellHeight,
        toColumnLabel(col),
        activeCell.c === col,
        isColSelected || false,
      );
    }

    // Render row headers
    for (let row = startID.r; row <= endID.r; row++) {
      const rowOffset = rowDim ? rowDim.getOffset(row) : DefaultCellHeight * (row - 1);
      const rowHeight = rowDim ? rowDim.getSize(row) : DefaultCellHeight;
      const x = 0;
      const y = rowOffset + DefaultCellHeight - scroll.top;
      const isRowSelected = selectionType === 'all' || (selectionType === 'row' && selectionRange &&
        row >= selectionRange[0].r && row <= selectionRange[1].r);
      this.renderHeader(
        ctx,
        x,
        y,
        RowHeaderWidth,
        rowHeight,
        String(row),
        activeCell.r === row,
        isRowSelected || false,
      );
    }

    // Render corner button (top-left intersection of row/column headers)
    const isAllSelected = selectionType === 'all';
    ctx.fillStyle = isAllSelected
      ? this.getThemeColor('headerSelectedBGColor')
      : this.getThemeColor('headerBGColor');
    ctx.fillRect(0, 0, RowHeaderWidth, DefaultCellHeight);
    ctx.strokeStyle = this.getThemeColor('cellBorderColor');
    ctx.lineWidth = CellBorderWidth;
    ctx.strokeRect(0, 0, RowHeaderWidth, DefaultCellHeight);
  }

  private renderHeader(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    width: number,
    height: number,
    label: string,
    selected: boolean,
    fullSelected: boolean = false,
  ): void {
    ctx.fillStyle = fullSelected
      ? this.getThemeColor('headerSelectedBGColor')
      : selected
        ? this.getThemeColor('headerActiveBGColor')
        : this.getThemeColor('headerBGColor');
    ctx.fillRect(x, y, width, height);
    ctx.strokeStyle = this.getThemeColor('cellBorderColor');
    ctx.lineWidth = CellBorderWidth;
    ctx.strokeRect(x, y, width, height);
    ctx.fillStyle = this.getThemeColor('cellTextColor');
    ctx.textAlign = HeaderTextAlign;
    ctx.font = (selected || fullSelected) ? 'bold 10px Arial' : '10px Arial';
    ctx.fillText(label, x + width / 2, y + Math.min(15, height - 4));
  }

  private renderCell(
    ctx: CanvasRenderingContext2D,
    id: Ref,
    cell: Cell | undefined,
    scroll: Position,
    rowDim?: DimensionIndex,
    colDim?: DimensionIndex,
  ): void {
    const rect = toBoundingRect(id, scroll, rowDim, colDim);

    ctx.strokeStyle = this.getThemeColor('cellTextColor');
    ctx.lineWidth = CellBorderWidth;
    ctx.strokeRect(rect.left, rect.top, rect.width, rect.height);
    ctx.fillStyle = this.getThemeColor('cellBGColor');
    ctx.fillRect(rect.left, rect.top, rect.width, rect.height);

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

  public cleanup(): void {
    this.canvas.remove();
  }
}
