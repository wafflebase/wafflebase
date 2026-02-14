import { Grid, Cell, Ref, Range, SelectionType, CellStyle } from '../model/types';
import { DimensionIndex } from '../model/dimensions';
import { formatValue } from '../model/format';
import { Theme, ThemeKey, getThemeColor } from './theme';
import { toColumnLabel, toSref } from '../model/coordinates';
import {
  DefaultCellWidth,
  DefaultCellHeight,
  RowHeaderWidth,
  CellBorderWidth,
  CellFontSize,
  CellLineHeight,
  CellPaddingX,
  CellPaddingY,
  HeaderTextAlign,
  BoundingRect,
  Position,
  FreezeState,
  NoFreeze,
  FreezeHandleThickness,
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
    freeze: FreezeState = NoFreeze,
    freezeHandleHover: 'row' | 'column' | null = null,
    colStyles?: Map<number, CellStyle>,
    rowStyles?: Map<number, CellStyle>,
    sheetStyle?: CellStyle,
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
    const hasFrozen = freeze.frozenRows > 0 || freeze.frozenCols > 0;

    if (!hasFrozen) {
      // No freeze: render everything as before
      this.renderQuadrantCells(
        ctx,
        startID.r,
        endID.r + 1,
        startID.c,
        endID.c + 1,
        grid,
        scroll,
        rowDim,
        colDim,
        colStyles,
        rowStyles,
        sheetStyle,
      );
      this.renderColumnHeaders(
        ctx,
        startID.c,
        endID.c,
        scroll.left,
        RowHeaderWidth,
        viewport.width,
        activeCell,
        selectionType,
        selectionRange,
        rowDim,
        colDim,
      );
      this.renderRowHeaders(
        ctx,
        startID.r,
        endID.r,
        scroll.top,
        DefaultCellHeight,
        viewport.height,
        activeCell,
        selectionType,
        selectionRange,
        rowDim,
        colDim,
      );
    } else {
      const fw = freeze.frozenWidth;
      const fh = freeze.frozenHeight;
      const fr = freeze.frozenRows;
      const fc = freeze.frozenCols;

      // Compute scroll for unfrozen area: offset relative to first unfrozen row/col
      const unfrozenRowStart = rowDim
        ? rowDim.getOffset(fr + 1)
        : fr * DefaultCellHeight;
      const unfrozenColStart = colDim
        ? colDim.getOffset(fc + 1)
        : fc * DefaultCellWidth;

      // Quadrant D (bottom-right): scrolled H + V — draw first (background)
      ctx.save();
      ctx.beginPath();
      ctx.rect(
        RowHeaderWidth + fw,
        DefaultCellHeight + fh,
        viewport.width - RowHeaderWidth - fw,
        viewport.height - DefaultCellHeight - fh,
      );
      ctx.clip();
      this.renderQuadrantCells(
        ctx,
        startID.r,
        endID.r + 1,
        startID.c,
        endID.c + 1,
        grid,
        {
          left: scroll.left + unfrozenColStart - fw,
          top: scroll.top + unfrozenRowStart - fh,
        },
        rowDim,
        colDim,
        colStyles,
        rowStyles,
        sheetStyle,
      );
      ctx.restore();

      // Quadrant B (top-right): frozen rows, scrolled H
      if (fr > 0) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(
          RowHeaderWidth + fw,
          DefaultCellHeight,
          viewport.width - RowHeaderWidth - fw,
          fh,
        );
        ctx.clip();
        this.renderQuadrantCells(
          ctx,
          1,
          fr + 1,
          startID.c,
          endID.c + 1,
          grid,
          { left: scroll.left + unfrozenColStart - fw, top: 0 },
          rowDim,
          colDim,
          colStyles,
          rowStyles,
          sheetStyle,
        );
        ctx.restore();
      }

      // Quadrant C (bottom-left): scrolled rows, frozen cols
      if (fc > 0) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(
          RowHeaderWidth,
          DefaultCellHeight + fh,
          fw,
          viewport.height - DefaultCellHeight - fh,
        );
        ctx.clip();
        this.renderQuadrantCells(
          ctx,
          startID.r,
          endID.r + 1,
          1,
          fc + 1,
          grid,
          { left: 0, top: scroll.top + unfrozenRowStart - fh },
          rowDim,
          colDim,
          colStyles,
          rowStyles,
          sheetStyle,
        );
        ctx.restore();
      }

      // Quadrant A (top-left): frozen R + C — draw last (foreground)
      if (fr > 0 && fc > 0) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(RowHeaderWidth, DefaultCellHeight, fw, fh);
        ctx.clip();
        this.renderQuadrantCells(
          ctx,
          1,
          fr + 1,
          1,
          fc + 1,
          grid,
          { left: 0, top: 0 },
          rowDim,
          colDim,
          colStyles,
          rowStyles,
          sheetStyle,
        );
        ctx.restore();
      }

      // Column headers — frozen columns (no scroll)
      if (fc > 0) {
        this.renderColumnHeaders(
          ctx,
          1,
          fc,
          0,
          RowHeaderWidth,
          RowHeaderWidth + fw,
          activeCell,
          selectionType,
          selectionRange,
          rowDim,
          colDim,
        );
      }
      // Column headers — unfrozen columns (scrolled)
      this.renderColumnHeaders(
        ctx,
        startID.c,
        endID.c,
        scroll.left + unfrozenColStart - fw,
        RowHeaderWidth + fw,
        viewport.width,
        activeCell,
        selectionType,
        selectionRange,
        rowDim,
        colDim,
      );

      // Row headers — frozen rows (no scroll)
      if (fr > 0) {
        this.renderRowHeaders(
          ctx,
          1,
          fr,
          0,
          DefaultCellHeight,
          DefaultCellHeight + fh,
          activeCell,
          selectionType,
          selectionRange,
          rowDim,
          colDim,
        );
      }
      // Row headers — unfrozen rows (scrolled)
      this.renderRowHeaders(
        ctx,
        startID.r,
        endID.r,
        scroll.top + unfrozenRowStart - fh,
        DefaultCellHeight + fh,
        viewport.height,
        activeCell,
        selectionType,
        selectionRange,
        rowDim,
        colDim,
      );

      // Freeze line separators
      this.renderFreezeLines(ctx, viewport, fw, fh);
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

    // Render freeze drag handles
    this.renderFreezeHandles(ctx, freeze, freezeHandleHover);
  }

  /**
   * Renders cells within a row/col range with the given scroll offset.
   */
  private renderQuadrantCells(
    ctx: CanvasRenderingContext2D,
    rowStart: number,
    rowEnd: number,
    colStart: number,
    colEnd: number,
    grid: Grid | undefined,
    scroll: Position,
    rowDim?: DimensionIndex,
    colDim?: DimensionIndex,
    colStyles?: Map<number, CellStyle>,
    rowStyles?: Map<number, CellStyle>,
    sheetStyle?: CellStyle,
  ): void {
    for (let row = rowStart; row <= rowEnd; row++) {
      const rStyle = rowStyles?.get(row);
      for (let col = colStart; col <= colEnd; col++) {
        const cell = grid?.get(toSref({ r: row, c: col }));
        const cStyle = colStyles?.get(col);
        // Merge styles: sheet → column → row → cell
        let effectiveStyle: CellStyle | undefined;
        if (sheetStyle || cStyle || rStyle || cell?.s) {
          effectiveStyle = { ...sheetStyle, ...cStyle, ...rStyle, ...cell?.s };
        }
        this.renderCell(
          ctx,
          { r: row, c: col },
          cell,
          scroll,
          rowDim,
          colDim,
          effectiveStyle,
        );
      }
    }
  }

  /**
   * Renders column headers within a clip range.
   */
  private renderColumnHeaders(
    ctx: CanvasRenderingContext2D,
    colStart: number,
    colEnd: number,
    scrollLeft: number,
    clipLeft: number,
    clipRight: number,
    activeCell: Ref,
    selectionType?: SelectionType,
    selectionRange?: Range,
    _rowDim?: DimensionIndex,
    colDim?: DimensionIndex,
  ): void {
    ctx.save();
    ctx.beginPath();
    ctx.rect(clipLeft, 0, clipRight - clipLeft, DefaultCellHeight);
    ctx.clip();

    for (let col = colStart; col <= colEnd; col++) {
      const colOffset = colDim
        ? colDim.getOffset(col)
        : DefaultCellWidth * (col - 1);
      const colWidth = colDim ? colDim.getSize(col) : DefaultCellWidth;
      const x = RowHeaderWidth + colOffset - scrollLeft;
      const y = 0;
      const isColSelected =
        selectionType === 'all' ||
        (selectionType === 'column' &&
          selectionRange &&
          col >= selectionRange[0].c &&
          col <= selectionRange[1].c);
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

    ctx.restore();
  }

  /**
   * Renders row headers within a clip range.
   */
  private renderRowHeaders(
    ctx: CanvasRenderingContext2D,
    rowStart: number,
    rowEnd: number,
    scrollTop: number,
    clipTop: number,
    clipBottom: number,
    activeCell: Ref,
    selectionType?: SelectionType,
    selectionRange?: Range,
    rowDim?: DimensionIndex,
    _colDim?: DimensionIndex,
  ): void {
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, clipTop, RowHeaderWidth, clipBottom - clipTop);
    ctx.clip();

    for (let row = rowStart; row <= rowEnd; row++) {
      const rowOffset = rowDim
        ? rowDim.getOffset(row)
        : DefaultCellHeight * (row - 1);
      const rowHeight = rowDim ? rowDim.getSize(row) : DefaultCellHeight;
      const x = 0;
      const y = rowOffset + DefaultCellHeight - scrollTop;
      const isRowSelected =
        selectionType === 'all' ||
        (selectionType === 'row' &&
          selectionRange &&
          row >= selectionRange[0].r &&
          row <= selectionRange[1].r);
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

    ctx.restore();
  }

  /**
   * Renders the freeze line separators.
   */
  private renderFreezeLines(
    ctx: CanvasRenderingContext2D,
    viewport: BoundingRect,
    frozenWidth: number,
    frozenHeight: number,
  ): void {
    ctx.strokeStyle = this.getThemeColor('freezeLineColor');
    ctx.lineWidth = 2;

    if (frozenHeight > 0) {
      const y = DefaultCellHeight + frozenHeight;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(viewport.width, y);
      ctx.stroke();
    }

    if (frozenWidth > 0) {
      const x = RowHeaderWidth + frozenWidth;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, viewport.height);
      ctx.stroke();
    }
  }

  /**
   * Renders the freeze drag handles at the corner header or at freeze line positions.
   */
  private renderFreezeHandles(
    ctx: CanvasRenderingContext2D,
    freeze: FreezeState,
    hoverHandle: 'row' | 'column' | null,
  ): void {
    const hasFrozen = freeze.frozenRows > 0 || freeze.frozenCols > 0;
    const t = FreezeHandleThickness;

    // --- Row freeze handle (horizontal bar spanning full row-header width) ---
    // Sits at the bottom edge of the header row (or at the freeze boundary)
    const rowBarY =
      hasFrozen && freeze.frozenRows > 0
        ? DefaultCellHeight + freeze.frozenHeight - t / 2
        : DefaultCellHeight - t;
    const isRowHover = hoverHandle === 'row';

    ctx.fillStyle = isRowHover
      ? this.getThemeColor('freezeHandleHoverColor')
      : this.getThemeColor('freezeHandleColor');
    ctx.fillRect(0, rowBarY, RowHeaderWidth, t);

    // --- Column freeze handle (vertical bar spanning full column-header height) ---
    // Sits at the right edge of the row-header column (or at the freeze boundary)
    const colBarX =
      hasFrozen && freeze.frozenCols > 0
        ? RowHeaderWidth + freeze.frozenWidth - t / 2
        : RowHeaderWidth - t;
    const isColHover = hoverHandle === 'column';

    ctx.fillStyle = isColHover
      ? this.getThemeColor('freezeHandleHoverColor')
      : this.getThemeColor('freezeHandleColor');
    ctx.fillRect(colBarX, 0, t, DefaultCellHeight);
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
    ctx.font = selected || fullSelected ? 'bold 10px Arial' : '10px Arial';
    ctx.fillText(label, x + width / 2, y + Math.min(15, height - 4));
  }

  private renderCell(
    ctx: CanvasRenderingContext2D,
    id: Ref,
    cell: Cell | undefined,
    scroll: Position,
    rowDim?: DimensionIndex,
    colDim?: DimensionIndex,
    effectiveStyle?: CellStyle,
  ): void {
    const rect = toBoundingRect(id, scroll, rowDim, colDim);
    const style = effectiveStyle ?? cell?.s;

    ctx.strokeStyle = this.getThemeColor('cellTextColor');
    ctx.lineWidth = CellBorderWidth;
    ctx.strokeRect(rect.left, rect.top, rect.width, rect.height);
    ctx.fillStyle = style?.bg || this.getThemeColor('cellBGColor');
    ctx.fillRect(rect.left, rect.top, rect.width, rect.height);

    const rawData = cell?.v || '';
    if (rawData) {
      const data = formatValue(rawData, style?.nf);
      const lines = data.split('\n');
      ctx.save();
      ctx.beginPath();
      ctx.rect(rect.left, rect.top, rect.width, rect.height);
      ctx.clip();
      ctx.fillStyle = style?.tc || this.getThemeColor('cellTextColor');

      // Build font string
      const fontParts: string[] = [];
      if (style?.b) fontParts.push('bold');
      if (style?.i) fontParts.push('italic');
      fontParts.push(`${CellFontSize}px Arial`);
      ctx.font = fontParts.join(' ');

      ctx.textBaseline = 'top';

      // Compute text alignment
      const align = style?.al || 'left';
      let textX: number;
      if (align === 'center') {
        ctx.textAlign = 'center';
        textX = rect.left + rect.width / 2;
      } else if (align === 'right') {
        ctx.textAlign = 'right';
        textX = rect.left + rect.width - CellPaddingX;
      } else {
        ctx.textAlign = 'left';
        textX = rect.left + CellPaddingX;
      }

      // Compute vertical alignment offset
      const vAlign = style?.va || 'top';
      const totalTextHeight =
        lines.length * CellFontSize * CellLineHeight;
      let baseY: number;
      if (vAlign === 'middle') {
        baseY = rect.top + (rect.height - totalTextHeight) / 2;
      } else if (vAlign === 'bottom') {
        baseY = rect.top + rect.height - totalTextHeight - CellPaddingY;
      } else {
        baseY = rect.top + CellPaddingY;
      }

      for (let i = 0; i < lines.length; i++) {
        const textY = baseY + i * (CellFontSize * CellLineHeight);
        ctx.fillText(lines[i], textX, textY);

        // Underline
        if (style?.u) {
          const metrics = ctx.measureText(lines[i]);
          const lineY = textY + CellFontSize + 1;
          let lineStartX: number;
          if (align === 'center') {
            lineStartX = textX - metrics.width / 2;
          } else if (align === 'right') {
            lineStartX = textX - metrics.width;
          } else {
            lineStartX = textX;
          }
          ctx.beginPath();
          ctx.strokeStyle = style?.tc || this.getThemeColor('cellTextColor');
          ctx.lineWidth = 1;
          ctx.moveTo(lineStartX, lineY);
          ctx.lineTo(lineStartX + metrics.width, lineY);
          ctx.stroke();
        }

        // Strikethrough
        if (style?.st) {
          const metrics = ctx.measureText(lines[i]);
          const lineY = textY + CellFontSize / 2;
          let lineStartX: number;
          if (align === 'center') {
            lineStartX = textX - metrics.width / 2;
          } else if (align === 'right') {
            lineStartX = textX - metrics.width;
          } else {
            lineStartX = textX;
          }
          ctx.beginPath();
          ctx.strokeStyle = style?.tc || this.getThemeColor('cellTextColor');
          ctx.lineWidth = 1;
          ctx.moveTo(lineStartX, lineY);
          ctx.lineTo(lineStartX + metrics.width, lineY);
          ctx.stroke();
        }
      }
      ctx.restore();
    }
  }

  private getThemeColor(key: ThemeKey): string {
    return getThemeColor(this.theme, key);
  }

  public cleanup(): void {
    this.canvas.remove();
  }
}
