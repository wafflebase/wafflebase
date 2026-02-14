import { Ref, Range, SelectionType } from '../model/types';
import { DimensionIndex } from '../model/dimensions';
import { parseRef } from '../model/coordinates';
import { Theme, ThemeKey, getThemeColor, getPeerCursorColor, getFormulaRangeColor } from './theme';
import {
  BoundingRect,
  toBoundingRect,
  expandBoundingRect,
  RowHeaderWidth,
  DefaultCellHeight,
  FreezeState,
  NoFreeze,
} from './layout';

/**
 * Quadrant clip region definition.
 */
type QuadrantClip = {
  x: number;
  y: number;
  width: number;
  height: number;
  scrollLeft: number;
  scrollTop: number;
};

export class Overlay {
  private canvas: HTMLCanvasElement;
  private theme: Theme;

  constructor(theme: Theme = 'light') {
    this.theme = theme;

    this.canvas = document.createElement('canvas');
    this.canvas.style.position = 'absolute';
    this.canvas.style.zIndex = '1';
    this.canvas.style.pointerEvents = 'none';
  }

  public cleanup() {
    this.canvas.remove();
  }

  public getContainer(): HTMLElement {
    return this.canvas;
  }

  public render(
    port: BoundingRect,
    scroll: { left: number; top: number },
    activeCell: Ref,
    peerPresences: Array<{
      clientID: string;
      presence: { activeCell: string };
    }>,
    range?: Range,
    rowDim?: DimensionIndex,
    colDim?: DimensionIndex,
    resizeHover?: { axis: 'row' | 'column'; index: number } | null,
    selectionType?: SelectionType,
    dragMove?: { axis: 'row' | 'column'; dropIndex: number } | null,
    formulaRanges?: Array<Range>,
    freeze: FreezeState = NoFreeze,
    freezeDrag?: { axis: 'row' | 'column'; targetIndex: number } | null,
    copyRange?: Range,
  ) {
    this.canvas.width = 0;
    this.canvas.height = 0;

    const ctx = this.canvas.getContext('2d')!;
    const ratio = window.devicePixelRatio || 1;

    this.canvas.width = port.width * ratio;
    this.canvas.height = port.height * ratio;
    this.canvas.style.width = port.width + 'px';
    this.canvas.style.height = port.height + 'px';
    ctx.scale(ratio, ratio);

    const hasFrozen = freeze.frozenRows > 0 || freeze.frozenCols > 0;

    if (!hasFrozen) {
      // No freeze: render everything in a single pass (original behavior)
      this.renderActiveCellSimple(ctx, activeCell, scroll, rowDim, colDim);
      this.renderSelectionSimple(ctx, port, scroll, range, selectionType, rowDim, colDim);
      this.renderPeerCursorsSimple(ctx, port, peerPresences, scroll, rowDim, colDim);
      this.renderFormulaRangesSimple(ctx, formulaRanges, scroll, rowDim, colDim);
      this.renderCopyRangeSimple(ctx, copyRange, scroll, rowDim, colDim);
    } else {
      // Freeze: render per-quadrant with clipping
      const quadrants = this.buildQuadrants(port, scroll, freeze, rowDim, colDim);

      // Render selection per quadrant
      this.renderSelectionFrozen(ctx, port, scroll, range, selectionType, rowDim, colDim, freeze, quadrants);

      // Render active cell per quadrant
      for (const q of quadrants) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(q.x, q.y, q.width, q.height);
        ctx.clip();

        const rect = toBoundingRect(activeCell, { left: q.scrollLeft, top: q.scrollTop }, rowDim, colDim);
        ctx.strokeStyle = this.getThemeColor('activeCellColor');
        ctx.lineWidth = 2;
        ctx.strokeRect(rect.left, rect.top, rect.width, rect.height);

        ctx.restore();
      }

      // Render peer cursors per quadrant
      for (const { clientID, presence } of peerPresences) {
        if (!presence.activeCell) continue;
        const peerRef = parseRef(presence.activeCell);
        const peerColor = getPeerCursorColor(this.theme, clientID);

        for (const q of quadrants) {
          ctx.save();
          ctx.beginPath();
          ctx.rect(q.x, q.y, q.width, q.height);
          ctx.clip();

          const rect = toBoundingRect(peerRef, { left: q.scrollLeft, top: q.scrollTop }, rowDim, colDim);
          if (rect.left >= -rect.width && rect.left < port.width &&
              rect.top >= -rect.height && rect.top < port.height) {
            ctx.strokeStyle = peerColor;
            ctx.lineWidth = 2;
            ctx.strokeRect(rect.left, rect.top, rect.width, rect.height);
          }

          ctx.restore();
        }
      }

      // Render formula ranges per quadrant
      if (formulaRanges && formulaRanges.length > 0) {
        for (let i = 0; i < formulaRanges.length; i++) {
          const fRange = formulaRanges[i];
          const color = getFormulaRangeColor(this.theme, i);

          for (const q of quadrants) {
            ctx.save();
            ctx.beginPath();
            ctx.rect(q.x, q.y, q.width, q.height);
            ctx.clip();

            const qScroll = { left: q.scrollLeft, top: q.scrollTop };
            const rangeRect = expandBoundingRect(
              toBoundingRect(fRange[0], qScroll, rowDim, colDim),
              toBoundingRect(fRange[1], qScroll, rowDim, colDim),
            );
            ctx.strokeStyle = color;
            ctx.lineWidth = 2;
            ctx.strokeRect(rangeRect.left, rangeRect.top, rangeRect.width, rangeRect.height);
            ctx.fillStyle = color + '20';
            ctx.fillRect(rangeRect.left, rangeRect.top, rangeRect.width, rangeRect.height);

            ctx.restore();
          }
        }
      }

      // Render copy range per quadrant
      if (copyRange) {
        for (const q of quadrants) {
          ctx.save();
          ctx.beginPath();
          ctx.rect(q.x, q.y, q.width, q.height);
          ctx.clip();

          const qScroll = { left: q.scrollLeft, top: q.scrollTop };
          this.drawCopyRangeBorder(ctx, copyRange, qScroll, rowDim, colDim);

          ctx.restore();
        }
      }
    }

    // Render resize hover highlight line (same for freeze/no-freeze)
    if (resizeHover && colDim && rowDim) {
      this.renderResizeHover(ctx, port, scroll, resizeHover, rowDim, colDim, freeze);
    }

    // Render drag-move drop indicator (same for freeze/no-freeze)
    if (dragMove && colDim && rowDim) {
      this.renderDragMoveIndicator(ctx, port, scroll, dragMove, rowDim, colDim, freeze);
    }

    // Render freeze drag preview line
    if (freezeDrag && colDim && rowDim) {
      this.renderFreezeDragPreview(ctx, port, freezeDrag, rowDim, colDim);
    }
  }

  /**
   * Builds quadrant clip regions for freeze rendering.
   */
  private buildQuadrants(
    port: BoundingRect,
    scroll: { left: number; top: number },
    freeze: FreezeState,
    rowDim?: DimensionIndex,
    colDim?: DimensionIndex,
  ): QuadrantClip[] {
    const fw = freeze.frozenWidth;
    const fh = freeze.frozenHeight;
    const unfrozenRowStart = rowDim ? rowDim.getOffset(freeze.frozenRows + 1) : 0;
    const unfrozenColStart = colDim ? colDim.getOffset(freeze.frozenCols + 1) : 0;

    const quadrants: QuadrantClip[] = [];

    // Quadrant D (bottom-right): always present
    quadrants.push({
      x: RowHeaderWidth + fw,
      y: DefaultCellHeight + fh,
      width: port.width - RowHeaderWidth - fw,
      height: port.height - DefaultCellHeight - fh,
      scrollLeft: scroll.left + unfrozenColStart - fw,
      scrollTop: scroll.top + unfrozenRowStart - fh,
    });

    // Quadrant B (top-right): frozen rows
    if (freeze.frozenRows > 0) {
      quadrants.push({
        x: RowHeaderWidth + fw,
        y: DefaultCellHeight,
        width: port.width - RowHeaderWidth - fw,
        height: fh,
        scrollLeft: scroll.left + unfrozenColStart - fw,
        scrollTop: 0,
      });
    }

    // Quadrant C (bottom-left): frozen cols
    if (freeze.frozenCols > 0) {
      quadrants.push({
        x: RowHeaderWidth,
        y: DefaultCellHeight + fh,
        width: fw,
        height: port.height - DefaultCellHeight - fh,
        scrollLeft: 0,
        scrollTop: scroll.top + unfrozenRowStart - fh,
      });
    }

    // Quadrant A (top-left): frozen rows + cols
    if (freeze.frozenRows > 0 && freeze.frozenCols > 0) {
      quadrants.push({
        x: RowHeaderWidth,
        y: DefaultCellHeight,
        width: fw,
        height: fh,
        scrollLeft: 0,
        scrollTop: 0,
      });
    }

    return quadrants;
  }

  // ---- Simple (no-freeze) rendering methods ----

  private renderActiveCellSimple(
    ctx: CanvasRenderingContext2D,
    activeCell: Ref,
    scroll: { left: number; top: number },
    rowDim?: DimensionIndex,
    colDim?: DimensionIndex,
  ): void {
    const rect = toBoundingRect(activeCell, scroll, rowDim, colDim);
    ctx.strokeStyle = this.getThemeColor('activeCellColor');
    ctx.lineWidth = 2;
    ctx.strokeRect(rect.left, rect.top, rect.width, rect.height);
  }

  private renderSelectionSimple(
    ctx: CanvasRenderingContext2D,
    port: BoundingRect,
    scroll: { left: number; top: number },
    range?: Range,
    selectionType?: SelectionType,
    rowDim?: DimensionIndex,
    colDim?: DimensionIndex,
  ): void {
    if (selectionType === 'all') {
      ctx.fillStyle = this.getThemeColor('selectionBGColor');
      ctx.fillRect(RowHeaderWidth, DefaultCellHeight, port.width - RowHeaderWidth, port.height - DefaultCellHeight);
    } else if (range) {
      if (selectionType === 'row') {
        const topRect = toBoundingRect(range[0], scroll, rowDim, colDim);
        const bottomRect = toBoundingRect(range[1], scroll, rowDim, colDim);
        const y = topRect.top;
        const height = bottomRect.top + bottomRect.height - topRect.top;
        ctx.fillStyle = this.getThemeColor('selectionBGColor');
        ctx.fillRect(RowHeaderWidth, y, port.width - RowHeaderWidth, height);
        ctx.strokeStyle = this.getThemeColor('activeCellColor');
        ctx.lineWidth = 1;
        ctx.strokeRect(RowHeaderWidth, y, port.width - RowHeaderWidth, height);
      } else if (selectionType === 'column') {
        const leftRect = toBoundingRect(range[0], scroll, rowDim, colDim);
        const rightRect = toBoundingRect(range[1], scroll, rowDim, colDim);
        const x = leftRect.left;
        const width = rightRect.left + rightRect.width - leftRect.left;
        ctx.fillStyle = this.getThemeColor('selectionBGColor');
        ctx.fillRect(x, DefaultCellHeight, width, port.height - DefaultCellHeight);
        ctx.strokeStyle = this.getThemeColor('activeCellColor');
        ctx.lineWidth = 1;
        ctx.strokeRect(x, DefaultCellHeight, width, port.height - DefaultCellHeight);
      } else {
        const rect = expandBoundingRect(
          toBoundingRect(range[0], scroll, rowDim, colDim),
          toBoundingRect(range[1], scroll, rowDim, colDim),
        );
        ctx.fillStyle = this.getThemeColor('selectionBGColor');
        ctx.fillRect(rect.left, rect.top, rect.width, rect.height);
        ctx.strokeStyle = this.getThemeColor('activeCellColor');
        ctx.lineWidth = 1;
        ctx.strokeRect(rect.left, rect.top, rect.width, rect.height);
      }
    }
  }

  private renderPeerCursorsSimple(
    ctx: CanvasRenderingContext2D,
    port: BoundingRect,
    peerPresences: Array<{ clientID: string; presence: { activeCell: string } }>,
    scroll: { left: number; top: number },
    rowDim?: DimensionIndex,
    colDim?: DimensionIndex,
  ): void {
    for (const { clientID, presence } of peerPresences) {
      if (!presence.activeCell) continue;

      const peerActiveCell = parseRef(presence.activeCell);
      const rect = toBoundingRect(peerActiveCell, scroll, rowDim, colDim);

      if (rect.left >= -rect.width && rect.left < port.width &&
          rect.top >= -rect.height && rect.top < port.height) {
        const peerColor = getPeerCursorColor(this.theme, clientID);
        ctx.strokeStyle = peerColor;
        ctx.lineWidth = 2;
        ctx.strokeRect(rect.left, rect.top, rect.width, rect.height);
      }
    }
  }

  private renderFormulaRangesSimple(
    ctx: CanvasRenderingContext2D,
    formulaRanges: Array<Range> | undefined,
    scroll: { left: number; top: number },
    rowDim?: DimensionIndex,
    colDim?: DimensionIndex,
  ): void {
    if (!formulaRanges || formulaRanges.length === 0) return;

    for (let i = 0; i < formulaRanges.length; i++) {
      const fRange = formulaRanges[i];
      const rangeRect = expandBoundingRect(
        toBoundingRect(fRange[0], scroll, rowDim, colDim),
        toBoundingRect(fRange[1], scroll, rowDim, colDim),
      );
      const color = getFormulaRangeColor(this.theme, i);
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.strokeRect(rangeRect.left, rangeRect.top, rangeRect.width, rangeRect.height);
      ctx.fillStyle = color + '20';
      ctx.fillRect(rangeRect.left, rangeRect.top, rangeRect.width, rangeRect.height);
    }
  }

  private renderCopyRangeSimple(
    ctx: CanvasRenderingContext2D,
    copyRange: Range | undefined,
    scroll: { left: number; top: number },
    rowDim?: DimensionIndex,
    colDim?: DimensionIndex,
  ): void {
    if (!copyRange) return;
    this.drawCopyRangeBorder(ctx, copyRange, scroll, rowDim, colDim);
  }

  private drawCopyRangeBorder(
    ctx: CanvasRenderingContext2D,
    copyRange: Range,
    scroll: { left: number; top: number },
    rowDim?: DimensionIndex,
    colDim?: DimensionIndex,
  ): void {
    const rect = expandBoundingRect(
      toBoundingRect(copyRange[0], scroll, rowDim, colDim),
      toBoundingRect(copyRange[1], scroll, rowDim, colDim),
    );
    ctx.strokeStyle = this.getThemeColor('activeCellColor');
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 3]);
    ctx.strokeRect(rect.left, rect.top, rect.width, rect.height);
    ctx.setLineDash([]);
  }

  // ---- Freeze-aware selection rendering ----

  private renderSelectionFrozen(
    ctx: CanvasRenderingContext2D,
    port: BoundingRect,
    _scroll: { left: number; top: number },
    range: Range | undefined,
    selectionType: SelectionType | undefined,
    rowDim: DimensionIndex | undefined,
    colDim: DimensionIndex | undefined,
    _freeze: FreezeState,
    quadrants: QuadrantClip[],
  ): void {
    if (selectionType === 'all') {
      ctx.fillStyle = this.getThemeColor('selectionBGColor');
      ctx.fillRect(RowHeaderWidth, DefaultCellHeight, port.width - RowHeaderWidth, port.height - DefaultCellHeight);
      return;
    }

    if (!range) return;

    for (const q of quadrants) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(q.x, q.y, q.width, q.height);
      ctx.clip();

      const qScroll = { left: q.scrollLeft, top: q.scrollTop };

      if (selectionType === 'row') {
        const topRect = toBoundingRect(range[0], qScroll, rowDim, colDim);
        const bottomRect = toBoundingRect(range[1], qScroll, rowDim, colDim);
        const y = topRect.top;
        const height = bottomRect.top + bottomRect.height - topRect.top;
        ctx.fillStyle = this.getThemeColor('selectionBGColor');
        ctx.fillRect(RowHeaderWidth, y, port.width - RowHeaderWidth, height);
        ctx.strokeStyle = this.getThemeColor('activeCellColor');
        ctx.lineWidth = 1;
        ctx.strokeRect(RowHeaderWidth, y, port.width - RowHeaderWidth, height);
      } else if (selectionType === 'column') {
        const leftRect = toBoundingRect(range[0], qScroll, rowDim, colDim);
        const rightRect = toBoundingRect(range[1], qScroll, rowDim, colDim);
        const x = leftRect.left;
        const width = rightRect.left + rightRect.width - leftRect.left;
        ctx.fillStyle = this.getThemeColor('selectionBGColor');
        ctx.fillRect(x, DefaultCellHeight, width, port.height - DefaultCellHeight);
        ctx.strokeStyle = this.getThemeColor('activeCellColor');
        ctx.lineWidth = 1;
        ctx.strokeRect(x, DefaultCellHeight, width, port.height - DefaultCellHeight);
      } else {
        const rect = expandBoundingRect(
          toBoundingRect(range[0], qScroll, rowDim, colDim),
          toBoundingRect(range[1], qScroll, rowDim, colDim),
        );
        ctx.fillStyle = this.getThemeColor('selectionBGColor');
        ctx.fillRect(rect.left, rect.top, rect.width, rect.height);
        ctx.strokeStyle = this.getThemeColor('activeCellColor');
        ctx.lineWidth = 1;
        ctx.strokeRect(rect.left, rect.top, rect.width, rect.height);
      }

      ctx.restore();
    }
  }

  // ---- Resize & drag indicators (freeze-aware) ----

  private renderResizeHover(
    ctx: CanvasRenderingContext2D,
    port: BoundingRect,
    scroll: { left: number; top: number },
    resizeHover: { axis: 'row' | 'column'; index: number },
    rowDim: DimensionIndex,
    colDim: DimensionIndex,
    freeze: FreezeState,
  ): void {
    ctx.strokeStyle = this.getThemeColor('resizeHandleColor');
    ctx.lineWidth = 2;

    if (resizeHover.axis === 'column') {
      const inFrozenCols = freeze.frozenCols > 0 && resizeHover.index <= freeze.frozenCols;
      const scrollLeft = inFrozenCols ? 0 : scroll.left + colDim.getOffset(freeze.frozenCols + 1) - freeze.frozenWidth;
      const x = RowHeaderWidth + colDim.getOffset(resizeHover.index) + colDim.getSize(resizeHover.index) - scrollLeft;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, port.height);
      ctx.stroke();
    } else {
      const inFrozenRows = freeze.frozenRows > 0 && resizeHover.index <= freeze.frozenRows;
      const scrollTop = inFrozenRows ? 0 : scroll.top + rowDim.getOffset(freeze.frozenRows + 1) - freeze.frozenHeight;
      const y = DefaultCellHeight + rowDim.getOffset(resizeHover.index) + rowDim.getSize(resizeHover.index) - scrollTop;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(port.width, y);
      ctx.stroke();
    }
  }

  private renderDragMoveIndicator(
    ctx: CanvasRenderingContext2D,
    port: BoundingRect,
    scroll: { left: number; top: number },
    dragMove: { axis: 'row' | 'column'; dropIndex: number },
    rowDim: DimensionIndex,
    colDim: DimensionIndex,
    freeze: FreezeState,
  ): void {
    ctx.strokeStyle = this.getThemeColor('dropIndicatorColor');
    ctx.lineWidth = 3;

    if (dragMove.axis === 'column') {
      const inFrozenCols = freeze.frozenCols > 0 && dragMove.dropIndex <= freeze.frozenCols;
      const scrollLeft = inFrozenCols ? 0 : scroll.left + colDim.getOffset(freeze.frozenCols + 1) - freeze.frozenWidth;
      const x = RowHeaderWidth + colDim.getOffset(dragMove.dropIndex) - scrollLeft;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, port.height);
      ctx.stroke();
    } else {
      const inFrozenRows = freeze.frozenRows > 0 && dragMove.dropIndex <= freeze.frozenRows;
      const scrollTop = inFrozenRows ? 0 : scroll.top + rowDim.getOffset(freeze.frozenRows + 1) - freeze.frozenHeight;
      const y = DefaultCellHeight + rowDim.getOffset(dragMove.dropIndex) - scrollTop;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(port.width, y);
      ctx.stroke();
    }
  }

  private renderFreezeDragPreview(
    ctx: CanvasRenderingContext2D,
    port: BoundingRect,
    freezeDrag: { axis: 'row' | 'column'; targetIndex: number },
    rowDim: DimensionIndex,
    colDim: DimensionIndex,
  ): void {
    ctx.strokeStyle = this.getThemeColor('freezeLineColor');
    ctx.lineWidth = 2;

    if (freezeDrag.axis === 'row') {
      const y = freezeDrag.targetIndex === 0
        ? DefaultCellHeight
        : DefaultCellHeight + rowDim.getOffset(freezeDrag.targetIndex + 1);
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(port.width, y);
      ctx.stroke();
    } else {
      const x = freezeDrag.targetIndex === 0
        ? RowHeaderWidth
        : RowHeaderWidth + colDim.getOffset(freezeDrag.targetIndex + 1);
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, port.height);
      ctx.stroke();
    }
  }

  private getThemeColor(key: ThemeKey): string {
    return getThemeColor(this.theme, key);
  }
}
