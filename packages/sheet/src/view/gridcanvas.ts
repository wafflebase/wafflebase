import { Grid, Cell, Ref, Range } from '../model/types';
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

    // Paint cells
    for (let row = startID.r; row <= endID.r + 1; row++) {
      for (let col = startID.c; col <= endID.c + 1; col++) {
        this.paintCell(
          ctx,
          { r: row, c: col },
          grid?.get(toSref({ r: row, c: col })),
          scroll,
        );
      }
    }

    // Paint column headers
    for (let col = startID.c; col <= endID.c; col++) {
      const x = RowHeaderWidth + DefaultCellWidth * (col - 1) - scroll.left;
      const y = 0;
      this.paintHeader(
        ctx,
        x,
        y,
        DefaultCellWidth,
        toColumnLabel(col),
        activeCell.c === col,
      );
    }

    // Paint row headers
    for (let row = startID.r; row <= endID.r; row++) {
      const x = 0;
      const y = row * DefaultCellHeight - scroll.top;
      this.paintHeader(
        ctx,
        x,
        y,
        RowHeaderWidth,
        String(row),
        activeCell.r === row,
      );
    }
  }

  private paintHeader(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    width: number,
    label: string,
    selected: boolean,
  ): void {
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

  private paintCell(
    ctx: CanvasRenderingContext2D,
    id: Ref,
    cell: Cell | undefined,
    scroll: Position,
  ): void {
    const rect = toBoundingRect(id, scroll);

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

  public cleanup(): void {
    this.canvas.remove();
  }
}
