import {
  Grid,
  Cell,
  Ref,
  Range,
  SelectionType,
  CellStyle,
  MergeSpan,
} from '../model/types';
import { DimensionIndex } from '../model/dimensions';
import { formatValue } from '../model/format';
import { Theme, ThemeKey, getThemeColor } from './theme';
import { parseRef, toColumnLabel, toSref } from '../model/coordinates';
import {
  DefaultCellWidth,
  DefaultCellHeight,
  RowHeaderWidth,
  CellBorderWidth,
  CustomCellBorderWidth,
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

type TextOverflowRenderData = {
  anchorToEndCol: Map<string, number>;
  hiddenVerticalBoundaries: Set<string>;
};

const TablerFilter2IconPath = 'M4 6h16 M6 12h12 M9 18h6';

/**
 * GridCanvas handles the rendering of the spreadsheet grid on a canvas element.
 */
export class GridCanvas {
  private canvas: HTMLCanvasElement;
  private theme: Theme;
  private static filterIconPath2D: Path2D | null | undefined;

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
    merges?: Map<string, MergeSpan>,
    filterRange?: Range,
    filteredColumns?: Set<number>,
    hoveredFilterButtonCol: number | null = null,
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
    const mergeData = this.buildMergeRenderData(merges);
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
        mergeData,
        filterRange,
        filteredColumns,
        hoveredFilterButtonCol,
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
      const unfrozenRowStartIndex = fr + 1;
      const unfrozenColStartIndex = fc + 1;
      const startUnfrozenRow = Math.max(unfrozenRowStartIndex, startID.r);
      const startUnfrozenCol = Math.max(unfrozenColStartIndex, startID.c);

      // Compute scroll for unfrozen area: offset relative to first unfrozen row/col
      const unfrozenRowStart = rowDim
        ? rowDim.getOffset(unfrozenRowStartIndex)
        : fr * DefaultCellHeight;
      const unfrozenColStart = colDim
        ? colDim.getOffset(unfrozenColStartIndex)
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
        startUnfrozenRow,
        endID.r + 1,
        startUnfrozenCol,
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
        mergeData,
        filterRange,
        filteredColumns,
        hoveredFilterButtonCol,
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
          startUnfrozenCol,
          endID.c + 1,
          grid,
          { left: scroll.left + unfrozenColStart - fw, top: 0 },
          rowDim,
          colDim,
          colStyles,
          rowStyles,
          sheetStyle,
          mergeData,
          filterRange,
          filteredColumns,
          hoveredFilterButtonCol,
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
          startUnfrozenRow,
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
          mergeData,
          filterRange,
          filteredColumns,
          hoveredFilterButtonCol,
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
          mergeData,
          filterRange,
          filteredColumns,
          hoveredFilterButtonCol,
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
        startUnfrozenCol,
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
        startUnfrozenRow,
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
    mergeData?: {
      anchors: Map<string, MergeSpan>;
      coverToAnchor: Map<string, string>;
    },
    filterRange?: Range,
    filteredColumns?: Set<number>,
    hoveredFilterButtonCol: number | null = null,
  ): void {
    const overflowData = this.buildTextOverflowRenderData(
      ctx,
      rowStart,
      rowEnd,
      colStart,
      colEnd,
      grid,
      colDim,
      colStyles,
      rowStyles,
      sheetStyle,
      mergeData,
    );

    // Three-pass rendering: backgrounds first, then custom borders, then text.
    // This ensures text overflow into empty neighbor cells is not
    // overwritten by the neighbor's background fill.

    // Pass 1: Render all cell backgrounds and default grid borders.
    for (let row = rowStart; row <= rowEnd; row++) {
      for (let col = colStart; col <= colEnd; col++) {
        const sref = toSref({ r: row, c: col });
        if (mergeData?.coverToAnchor.has(sref)) {
          continue;
        }
        const cell = grid?.get(toSref({ r: row, c: col }));
        const mergeSpan = mergeData?.anchors.get(sref);
        const effectiveStyle = this.resolveEffectiveStyle(
          row,
          col,
          cell,
          sheetStyle,
          colStyles,
          rowStyles,
        );
        const hideLeftBorder = overflowData?.hiddenVerticalBoundaries.has(
          this.verticalBoundaryKey(row, col - 1),
        );
        const hideRightBorder = overflowData?.hiddenVerticalBoundaries.has(
          this.verticalBoundaryKey(row, col),
        );
        this.renderCellBackground(
          ctx,
          { r: row, c: col },
          cell,
          scroll,
          rowDim,
          colDim,
          effectiveStyle,
          mergeSpan,
          hideLeftBorder,
          hideRightBorder,
        );
      }
    }

    // Pass 2: Render custom cell borders.
    for (let row = rowStart; row <= rowEnd; row++) {
      for (let col = colStart; col <= colEnd; col++) {
        const sref = toSref({ r: row, c: col });
        if (mergeData?.coverToAnchor.has(sref)) {
          continue;
        }
        const cell = grid?.get(toSref({ r: row, c: col }));
        const mergeSpan = mergeData?.anchors.get(sref);
        const effectiveStyle = this.resolveEffectiveStyle(
          row,
          col,
          cell,
          sheetStyle,
          colStyles,
          rowStyles,
        );
        this.renderCellCustomBorders(
          ctx,
          { r: row, c: col },
          scroll,
          rowDim,
          colDim,
          effectiveStyle,
          mergeSpan,
        );
      }
    }

    // Pass 3: Render all cell text content (with overflow clipping).
    for (let row = rowStart; row <= rowEnd; row++) {
      for (let col = colStart; col <= colEnd; col++) {
        const sref = toSref({ r: row, c: col });
        if (mergeData?.coverToAnchor.has(sref)) {
          continue;
        }
        const cell = grid?.get(toSref({ r: row, c: col }));
        const mergeSpan = mergeData?.anchors.get(sref);
        const effectiveStyle = this.resolveEffectiveStyle(
          row,
          col,
          cell,
          sheetStyle,
          colStyles,
          rowStyles,
        );
        const overflowEndCol = overflowData?.anchorToEndCol.get(sref);
        this.renderCellContent(
          ctx,
          { r: row, c: col },
          cell,
          scroll,
          rowDim,
          colDim,
          effectiveStyle,
          grid,
          colEnd,
          mergeSpan,
          overflowEndCol,
        );
      }
    }

    // Pass 4: Render filter dropdown buttons inside filter header row cells.
    if (filterRange) {
      const headerRow = filterRange[0].r;
      if (headerRow >= rowStart && headerRow <= rowEnd) {
        const startCol = Math.max(colStart, filterRange[0].c);
        const endCol = Math.min(colEnd, filterRange[1].c);
        for (let col = startCol; col <= endCol; col++) {
          const sref = toSref({ r: headerRow, c: col });
          if (mergeData?.coverToAnchor.has(sref)) {
            continue;
          }
          const mergeSpan = mergeData?.anchors.get(sref);
          this.renderCellFilterButton(
            ctx,
            { r: headerRow, c: col },
            scroll,
            rowDim,
            colDim,
            mergeSpan,
            !!filteredColumns?.has(col),
            hoveredFilterButtonCol === col,
          );
        }
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

  private renderCellFilterButton(
    ctx: CanvasRenderingContext2D,
    id: Ref,
    scroll: Position,
    rowDim?: DimensionIndex,
    colDim?: DimensionIndex,
    mergeSpan?: MergeSpan,
    active = false,
    hovered = false,
  ): void {
    const rect = this.toCellRect(id, scroll, rowDim, colDim, mergeSpan);
    const width = rect.width;
    const height = rect.height;
    if (width <= 6 || height <= 6) {
      return;
    }

    const buttonWidth = Math.min(16, Math.max(12, width - 4));
    const buttonHeight = Math.min(16, Math.max(12, height - 6));
    const left = rect.left + width - buttonWidth - 2;
    const top = rect.top + Math.max(3, (height - buttonHeight) / 2);

    if (active || hovered) {
      ctx.fillStyle = active
        ? this.getThemeColor('selectionBGColor')
        : this.getThemeColor('headerSelectedBGColor');
      ctx.fillRect(left, top, buttonWidth, buttonHeight);
    }

    const iconColor = active || hovered
      ? this.getThemeColor('resizeHandleColor')
      : this.getThemeColor('cellTextColor');
    const iconSize = Math.max(9, Math.min(12, Math.min(buttonWidth, buttonHeight) - 3));
    const iconLeft = left + (buttonWidth - iconSize) / 2;
    const iconTop = top + (buttonHeight - iconSize) / 2;

    ctx.save();
    ctx.translate(iconLeft, iconTop);
    ctx.scale(iconSize / 24, iconSize / 24);
    ctx.strokeStyle = iconColor;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    const path2d = this.getFilterIconPath2D();
    if (path2d) {
      ctx.lineWidth = 2;
      ctx.stroke(path2d);
    } else {
      // Fallback when Path2D is unavailable (e.g., some test environments).
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(4, 6);
      ctx.lineTo(20, 6);
      ctx.moveTo(6, 12);
      ctx.lineTo(18, 12);
      ctx.moveTo(9, 18);
      ctx.lineTo(15, 18);
      ctx.stroke();
    }
    ctx.restore();
  }

  private getFilterIconPath2D(): Path2D | null {
    if (typeof Path2D === 'undefined') {
      return null;
    }
    if (GridCanvas.filterIconPath2D === undefined) {
      GridCanvas.filterIconPath2D = new Path2D(TablerFilter2IconPath);
    }
    return GridCanvas.filterIconPath2D;
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
      if (rowHeight <= 0) {
        continue;
      }
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
    if (width <= 0 || height <= 0) {
      return;
    }
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

  private renderCellBackground(
    ctx: CanvasRenderingContext2D,
    id: Ref,
    cell: Cell | undefined,
    scroll: Position,
    rowDim?: DimensionIndex,
    colDim?: DimensionIndex,
    effectiveStyle?: CellStyle,
    mergeSpan?: MergeSpan,
    hideLeftBorder: boolean = false,
    hideRightBorder: boolean = false,
  ): void {
    const rect = this.toCellRect(id, scroll, rowDim, colDim, mergeSpan);
    const style = effectiveStyle ?? cell?.s;

    ctx.fillStyle = style?.bg || this.getThemeColor('cellBGColor');
    ctx.fillRect(rect.left, rect.top, rect.width, rect.height);

    ctx.beginPath();
    ctx.strokeStyle = this.getThemeColor('cellBorderColor');
    ctx.lineWidth = CellBorderWidth;
    if (!hideLeftBorder) {
      ctx.moveTo(rect.left, rect.top);
      ctx.lineTo(rect.left, rect.top + rect.height);
    }
    if (!hideRightBorder) {
      const x = rect.left + rect.width;
      ctx.moveTo(x, rect.top);
      ctx.lineTo(x, rect.top + rect.height);
    }
    ctx.moveTo(rect.left, rect.top);
    ctx.lineTo(rect.left + rect.width, rect.top);
    ctx.moveTo(rect.left, rect.top + rect.height);
    ctx.lineTo(rect.left + rect.width, rect.top + rect.height);
    ctx.stroke();
  }

  private renderCellCustomBorders(
    ctx: CanvasRenderingContext2D,
    id: Ref,
    scroll: Position,
    rowDim?: DimensionIndex,
    colDim?: DimensionIndex,
    style?: CellStyle,
    mergeSpan?: MergeSpan,
  ): void {
    if (!style || (!style.bt && !style.br && !style.bb && !style.bl)) {
      return;
    }

    const rect = this.toCellRect(id, scroll, rowDim, colDim, mergeSpan);
    ctx.beginPath();
    ctx.strokeStyle = this.getThemeColor('customBorderColor');
    ctx.lineWidth = CustomCellBorderWidth;

    if (style.bt) {
      ctx.moveTo(rect.left, rect.top);
      ctx.lineTo(rect.left + rect.width, rect.top);
    }
    if (style.br) {
      const x = rect.left + rect.width;
      ctx.moveTo(x, rect.top);
      ctx.lineTo(x, rect.top + rect.height);
    }
    if (style.bb) {
      const y = rect.top + rect.height;
      ctx.moveTo(rect.left, y);
      ctx.lineTo(rect.left + rect.width, y);
    }
    if (style.bl) {
      ctx.moveTo(rect.left, rect.top);
      ctx.lineTo(rect.left, rect.top + rect.height);
    }

    ctx.stroke();
  }

  private renderCellContent(
    ctx: CanvasRenderingContext2D,
    id: Ref,
    cell: Cell | undefined,
    scroll: Position,
    rowDim?: DimensionIndex,
    colDim?: DimensionIndex,
    effectiveStyle?: CellStyle,
    grid?: Grid,
    colEnd?: number,
    mergeSpan?: MergeSpan,
    overflowEndCol?: number,
  ): void {
    const rect = this.toCellRect(id, scroll, rowDim, colDim, mergeSpan);
    const style = effectiveStyle ?? cell?.s;

    const rawData = cell?.v || '';
    if (rawData) {
      const data = formatValue(rawData, style?.nf, style?.dp);
      const lines = data.split('\n');

      // Build font string (needed for measuring text width)
      const fontStr = this.toCellFont(style);

      // Compute overflow clip width for single-line, left-aligned text
      let clipWidth = rect.width;
      const align = style?.al || 'left';
      if (!mergeSpan && overflowEndCol && colDim && overflowEndCol > id.c) {
        let extraWidth = 0;
        for (let nextCol = id.c + 1; nextCol <= overflowEndCol; nextCol++) {
          extraWidth += colDim.getSize(nextCol);
        }
        clipWidth = rect.width + extraWidth;
      } else if (
        !mergeSpan &&
        lines.length === 1 &&
        align === 'left' &&
        grid &&
        colDim &&
        colEnd
      ) {
        ctx.save();
        ctx.font = fontStr;
        const textWidth = ctx.measureText(data).width + CellPaddingX * 2;
        ctx.restore();

        if (textWidth > rect.width) {
          let extraWidth = 0;
          for (let nextCol = id.c + 1; nextCol <= colEnd; nextCol++) {
            const neighborCell = grid.get(toSref({ r: id.r, c: nextCol }));
            if (neighborCell && (neighborCell.v || neighborCell.f)) break;
            const neighborWidth = colDim.getSize(nextCol);
            extraWidth += neighborWidth;
            if (rect.width + extraWidth >= textWidth) break;
          }
          clipWidth = rect.width + extraWidth;
        }
      }

      ctx.save();
      ctx.beginPath();
      ctx.rect(rect.left, rect.top, clipWidth, rect.height);
      ctx.clip();
      ctx.fillStyle = style?.tc || this.getThemeColor('cellTextColor');

      ctx.font = fontStr;
      ctx.textBaseline = 'top';

      // Compute text alignment
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
      const totalTextHeight = lines.length * CellFontSize * CellLineHeight;
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

  private buildTextOverflowRenderData(
    ctx: CanvasRenderingContext2D,
    rowStart: number,
    rowEnd: number,
    colStart: number,
    colEnd: number,
    grid: Grid | undefined,
    colDim?: DimensionIndex,
    colStyles?: Map<number, CellStyle>,
    rowStyles?: Map<number, CellStyle>,
    sheetStyle?: CellStyle,
    mergeData?: {
      anchors: Map<string, MergeSpan>;
      coverToAnchor: Map<string, string>;
    },
  ): TextOverflowRenderData | undefined {
    if (!grid || !colDim) return undefined;

    const anchorToEndCol = new Map<string, number>();
    const hiddenVerticalBoundaries = new Set<string>();

    ctx.save();
    for (let row = rowStart; row <= rowEnd; row++) {
      for (let col = colStart; col <= colEnd; col++) {
        const sref = toSref({ r: row, c: col });
        if (mergeData?.coverToAnchor.has(sref) || mergeData?.anchors.has(sref)) {
          continue;
        }

        const cell = grid.get(sref);
        const rawData = cell?.v || '';
        if (!rawData) {
          continue;
        }

        const style = this.resolveEffectiveStyle(
          row,
          col,
          cell,
          sheetStyle,
          colStyles,
          rowStyles,
        );

        const align = style?.al || 'left';
        if (align !== 'left') {
          continue;
        }

        const data = formatValue(rawData, style?.nf, style?.dp);
        const lines = data.split('\n');
        if (lines.length !== 1) {
          continue;
        }

        const cellWidth = colDim.getSize(col);
        ctx.font = this.toCellFont(style);
        const textWidth = ctx.measureText(data).width + CellPaddingX * 2;
        if (textWidth <= cellWidth) {
          continue;
        }

        let width = cellWidth;
        let overflowEndCol = col;
        for (let nextCol = col + 1; nextCol <= colEnd; nextCol++) {
          const leftStyle = this.resolveEffectiveStyle(
            row,
            nextCol - 1,
            grid.get(toSref({ r: row, c: nextCol - 1 })),
            sheetStyle,
            colStyles,
            rowStyles,
          );
          const rightStyle = this.resolveEffectiveStyle(
            row,
            nextCol,
            grid.get(toSref({ r: row, c: nextCol })),
            sheetStyle,
            colStyles,
            rowStyles,
          );
          if (leftStyle?.br || rightStyle?.bl) {
            break;
          }

          const nextSref = toSref({ r: row, c: nextCol });
          if (
            mergeData?.coverToAnchor.has(nextSref) ||
            mergeData?.anchors.has(nextSref)
          ) {
            break;
          }
          const neighbor = grid.get(nextSref);
          if (neighbor && (neighbor.v || neighbor.f)) {
            break;
          }
          width += colDim.getSize(nextCol);
          overflowEndCol = nextCol;
          if (width >= textWidth) {
            break;
          }
        }

        if (overflowEndCol > col) {
          anchorToEndCol.set(sref, overflowEndCol);
          for (
            let boundaryCol = col;
            boundaryCol < overflowEndCol;
            boundaryCol++
          ) {
            hiddenVerticalBoundaries.add(
              this.verticalBoundaryKey(row, boundaryCol),
            );
          }
        }
      }
    }
    ctx.restore();

    if (anchorToEndCol.size === 0) {
      return undefined;
    }

    return { anchorToEndCol, hiddenVerticalBoundaries };
  }

  private resolveEffectiveStyle(
    row: number,
    col: number,
    cell?: Cell,
    sheetStyle?: CellStyle,
    colStyles?: Map<number, CellStyle>,
    rowStyles?: Map<number, CellStyle>,
  ): CellStyle | undefined {
    const cStyle = colStyles?.get(col);
    const rStyle = rowStyles?.get(row);
    if (!sheetStyle && !cStyle && !rStyle && !cell?.s) {
      return undefined;
    }
    return { ...sheetStyle, ...cStyle, ...rStyle, ...cell?.s };
  }

  /**
   * Builds merge lookup maps for rendering.
   */
  private buildMergeRenderData(
    merges?: Map<string, MergeSpan>,
  ): { anchors: Map<string, MergeSpan>; coverToAnchor: Map<string, string> } | undefined {
    if (!merges || merges.size === 0) return undefined;
    const anchors = new Map<string, MergeSpan>();
    const coverToAnchor = new Map<string, string>();

    for (const [anchorSref, span] of merges) {
      anchors.set(anchorSref, span);
      const anchor = parseRef(anchorSref);
      for (let r = anchor.r; r < anchor.r + span.rs; r++) {
        for (let c = anchor.c; c < anchor.c + span.cs; c++) {
          const sref = toSref({ r, c });
          if (sref === anchorSref) continue;
          coverToAnchor.set(sref, anchorSref);
        }
      }
    }
    return { anchors, coverToAnchor };
  }

  /**
   * Returns the rect for a regular or merged anchor cell.
   */
  private toCellRect(
    id: Ref,
    scroll: Position,
    rowDim?: DimensionIndex,
    colDim?: DimensionIndex,
    mergeSpan?: MergeSpan,
  ): BoundingRect {
    const start = toBoundingRect(id, scroll, rowDim, colDim);
    if (!mergeSpan || (mergeSpan.rs === 1 && mergeSpan.cs === 1)) {
      return start;
    }
    const end = toBoundingRect(
      { r: id.r + mergeSpan.rs - 1, c: id.c + mergeSpan.cs - 1 },
      scroll,
      rowDim,
      colDim,
    );
    return {
      left: start.left,
      top: start.top,
      width: end.left + end.width - start.left,
      height: end.top + end.height - start.top,
    };
  }

  private toCellFont(style?: CellStyle): string {
    const fontParts: string[] = [];
    if (style?.b) fontParts.push('bold');
    if (style?.i) fontParts.push('italic');
    fontParts.push(`${CellFontSize}px Arial`);
    return fontParts.join(' ');
  }

  private verticalBoundaryKey(row: number, col: number): string {
    return `${row}:${col}`;
  }

  private getThemeColor(key: ThemeKey): string {
    return getThemeColor(this.theme, key);
  }

  public cleanup(): void {
    this.canvas.remove();
  }
}
