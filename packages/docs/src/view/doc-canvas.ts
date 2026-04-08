import type { Block } from '../model/types.js';
import { LIST_INDENT_PX, UNORDERED_MARKERS } from '../model/types.js';
import type { PaginatedLayout } from './pagination.js';
import { getPageYOffset, getPageXOffset } from './pagination.js';
import type { DocumentLayout } from './layout.js';
import type { LayoutRun } from './layout.js';
import { computeListCounters } from './layout.js';
import { Theme, buildFont, ptToPx } from './theme.js';
import { drawPeerCaret, drawPeerLabel } from './peer-cursor.js';
import { renderTable } from './table-renderer.js';

/**
 * Convert a peer cursor color (hex) to a translucent selection fill.
 */
function peerColorToSelectionColor(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, 0.2)`;
}

/**
 * Canvas rendering engine for the document editor.
 * Paints paginated pages with shadows, styled text runs, cursor, and selection highlights.
 */
export class DocCanvas {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Failed to get 2d context');
    this.ctx = ctx;
  }

  getContext(): CanvasRenderingContext2D {
    return this.ctx;
  }

  /**
   * Render the full paginated document.
   */
  render(
    paginatedLayout: PaginatedLayout,
    scrollY: number,
    canvasWidth: number,
    viewportHeight: number,
    cursor?: { x: number; y: number; height: number; visible: boolean },
    selectionRects?: Array<{ x: number; y: number; width: number; height: number }>,
    focused: boolean = true,
    peerCursors?: Array<{
      pixel: { x: number; y: number; height: number };
      color: string;
      username: string;
      labelVisible: boolean;
      stackIndex: number;
    }>,
    peerSelections?: Array<{
      color: string;
      rects: Array<{ x: number; y: number; width: number; height: number }>;
    }>,
    layout?: DocumentLayout,
    searchHighlightRects?: Array<Array<{ x: number; y: number; width: number; height: number }>>,
    activeSearchIndex?: number,
    scaleFactor: number = 1,
  ): void {
    const dpr = window.devicePixelRatio || 1;
    const logicalWidth = this.canvas.width / dpr;
    const logicalHeight = this.canvas.height / dpr;

    const listCounters = layout ? computeListCounters(layout.blocks.map(b => b.block)) : new Map<string, string>();

    // Clear with canvas background
    this.ctx.fillStyle = Theme.canvasBackground;
    this.ctx.fillRect(0, 0, logicalWidth, logicalHeight);

    const pageX = getPageXOffset(paginatedLayout, canvasWidth);
    const { margins } = paginatedLayout.pageSetup;

    // Canvas is viewport-sized. Translate by -scrollY so that absolute
    // document coordinates map into the visible canvas area.
    const visibleTop = scrollY;
    const visibleBottom = scrollY + viewportHeight / scaleFactor;

    this.ctx.save();
    if (scaleFactor !== 1) {
      this.ctx.scale(scaleFactor, scaleFactor);
    }
    this.ctx.translate(0, -scrollY);

    for (const page of paginatedLayout.pages) {
      const pageY = getPageYOffset(paginatedLayout, page.pageIndex);

      // Viewport culling
      if (pageY + page.height < visibleTop || pageY > visibleBottom) continue;

      // Draw shadow
      this.ctx.save();
      this.ctx.shadowColor = Theme.pageShadowColor;
      this.ctx.shadowBlur = Theme.pageShadowBlur;
      this.ctx.shadowOffsetX = Theme.pageShadowOffsetX;
      this.ctx.shadowOffsetY = Theme.pageShadowOffsetY;
      this.ctx.fillStyle = Theme.pageBackground;
      this.ctx.fillRect(pageX, pageY, page.width, page.height);
      this.ctx.restore();

      // Clip to content area
      const contentX = pageX + margins.left;
      const contentY = pageY + margins.top;
      const contentWidth = page.width - margins.left - margins.right;
      const contentHeight = page.height - margins.top - margins.bottom;

      this.ctx.save();
      this.ctx.beginPath();
      this.ctx.rect(contentX, contentY, contentWidth, contentHeight);
      this.ctx.clip();

      // Draw search match highlights for this page (behind all selections)
      if (searchHighlightRects) {
        for (let mi = 0; mi < searchHighlightRects.length; mi++) {
          const isActive = mi === activeSearchIndex;
          this.ctx.fillStyle = isActive ? '#f4a939' : '#fff2a8';
          for (const rect of searchHighlightRects[mi]) {
            if (rect.y + rect.height > pageY && rect.y < pageY + page.height) {
              this.ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
            }
          }
        }
      }

      // Draw peer selection highlights for this page (behind local selection)
      if (peerSelections) {
        for (const ps of peerSelections) {
          this.ctx.fillStyle = peerColorToSelectionColor(ps.color);
          for (const rect of ps.rects) {
            if (rect.y + rect.height > pageY && rect.y < pageY + page.height) {
              this.ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
            }
          }
        }
      }

      // Draw local selection highlights for this page
      if (selectionRects) {
        this.ctx.fillStyle = focused ? Theme.selectionColor : Theme.selectionColorInactive;
        for (const rect of selectionRects) {
          if (rect.y + rect.height > pageY && rect.y < pageY + page.height) {
            this.ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
          }
        }
      }

      // Draw text
      for (const pl of page.lines) {
        // Render horizontal-rule blocks as a thin line
        if (layout) {
          const block = layout.blocks[pl.blockIndex]?.block;
          if (block && block.type === 'horizontal-rule') {
            const lineY = Math.round(pageY + pl.y + pl.line.height / 2);
            this.ctx.beginPath();
            this.ctx.strokeStyle = Theme.defaultColor;
            this.ctx.lineWidth = 1;
            this.ctx.moveTo(pageX + margins.left, lineY);
            this.ctx.lineTo(pageX + page.width - margins.right, lineY);
            this.ctx.stroke();
            continue;
          }

          if (block && block.type === 'page-break') {
            const lineY = Math.round(pageY + pl.y + pl.line.height / 2);
            // Draw "Page break" label centered
            this.ctx.font = '9px Arial';
            this.ctx.fillStyle = '#aaa';
            this.ctx.textAlign = 'center';
            this.ctx.textBaseline = 'middle';
            const centerX = pageX + page.width / 2;
            this.ctx.fillText('Page break', centerX, lineY);
            // Draw dashed line on both sides of the label
            const labelWidth = this.ctx.measureText('Page break').width + 16;
            this.ctx.beginPath();
            this.ctx.strokeStyle = '#ccc';
            this.ctx.lineWidth = 1;
            this.ctx.setLineDash([4, 4]);
            this.ctx.moveTo(pageX + margins.left, lineY);
            this.ctx.lineTo(centerX - labelWidth / 2, lineY);
            this.ctx.moveTo(centerX + labelWidth / 2, lineY);
            this.ctx.lineTo(pageX + page.width - margins.right, lineY);
            this.ctx.stroke();
            this.ctx.setLineDash([]);
            this.ctx.textAlign = 'left';
            this.ctx.textBaseline = 'alphabetic';
            continue;
          }

          const lb = layout.blocks[pl.blockIndex];
          if (lb && lb.block.type === 'table' && lb.layoutTable && lb.block.tableData) {
            // Collect contiguous table rows on this page for this block
            const startRowIndex = pl.lineIndex;
            let endRowIndex = startRowIndex + 1;
            // Peek ahead: find last consecutive row for this block on this page
            const plIndex = page.lines.indexOf(pl);
            for (let k = plIndex + 1; k < page.lines.length; k++) {
              const nextPl = page.lines[k];
              if (nextPl.blockIndex === pl.blockIndex) {
                endRowIndex = nextPl.lineIndex + 1;
              } else {
                break;
              }
            }
            // Render only on the first row PageLine; skip subsequent rows
            if (plIndex === 0 || page.lines[plIndex - 1]?.blockIndex !== pl.blockIndex) {
              // Extend startRow backwards to include rowSpan owners from previous pages
              let renderStartRow = startRowIndex;
              for (let r = 0; r < startRowIndex; r++) {
                for (let c = 0; c < lb.block.tableData.rows[r].cells.length; c++) {
                  const cell = lb.block.tableData.rows[r].cells[c];
                  const rs = cell.rowSpan ?? 1;
                  if (rs > 1 && r + rs > startRowIndex) {
                    renderStartRow = Math.min(renderStartRow, r);
                  }
                }
              }
              const tableOriginY = pageY + pl.y - lb.layoutTable.rowYOffsets[startRowIndex];
              renderTable(
                this.ctx,
                lb.block.tableData,
                lb.layoutTable,
                pageX + margins.left,
                tableOriginY,
                renderStartRow,
                endRowIndex,
              );
            }
            continue;
          }
        }

        for (const run of pl.line.runs) {
          this.renderRun(run, pageX + pl.x, pageY + pl.y, pl.line.height);
        }

        // Render list markers on the first line of each list-item block
        if (pl.lineIndex === 0 && layout) {
          const block = layout.blocks[pl.blockIndex]?.block;
          if (block?.type === 'list-item') {
            const level = block.listLevel ?? 0;
            const markerX = pageX + margins.left + LIST_INDENT_PX * level + LIST_INDENT_PX / 2 - 4;
            const marker = block.listKind === 'unordered'
              ? UNORDERED_MARKERS[level % UNORDERED_MARKERS.length]
              : (listCounters.get(block.id) ?? '1.');
            this.renderListMarker(block, pageY + pl.y, pl.line.height, markerX, marker);
          }
        }
      }

      // Draw cursor if on this page (only when focused)
      if (focused && cursor?.visible) {
        if (cursor.y >= pageY + margins.top &&
            cursor.y < pageY + margins.top + contentHeight) {
          this.ctx.fillStyle = Theme.cursorColor;
          this.ctx.fillRect(cursor.x, cursor.y, Theme.cursorWidth, cursor.height);
        }
      }

      this.ctx.restore();

      // Draw peer cursors on this page (after clip restore so labels aren't clipped)
      if (peerCursors) {
        const pageTop = pageY + margins.top;
        const pageBottom = pageY + margins.top + contentHeight;
        for (const peer of peerCursors) {
          if (peer.pixel.y >= pageTop && peer.pixel.y < pageBottom) {
            // Clip only the caret to content area
            this.ctx.save();
            this.ctx.beginPath();
            this.ctx.rect(contentX, contentY, contentWidth, contentHeight);
            this.ctx.clip();
            drawPeerCaret(this.ctx, peer.pixel, peer.color);
            this.ctx.restore();

            // Draw label unclipped
            if (peer.labelVisible) {
              drawPeerLabel(
                this.ctx,
                peer.pixel,
                peer.username,
                peer.color,
                pageTop,
                canvasWidth,
                peer.stackIndex,
              );
            }
          }
        }
      }
    }

    // Restore the scrollY translation
    this.ctx.restore();
  }

  /**
   * Render a single text run.
   */
  private renderRun(
    run: LayoutRun,
    lineX: number,
    lineY: number,
    lineHeight: number,
  ): void {
    const style = run.inline.style;
    const originalFontSizePx = ptToPx(style.fontSize ?? Theme.defaultFontSize);

    // Superscript/subscript: reduce font size to 60% and shift baseline
    const isSuperscript = style.superscript === true;
    const isSubscript = style.subscript === true;
    const renderFontSize = (isSuperscript || isSubscript)
      ? (style.fontSize ?? Theme.defaultFontSize) * 0.6
      : style.fontSize;

    // Link defaults: blue text + underline (user-set values take precedence)
    let textColor = style.color || Theme.defaultColor;
    let showUnderline = style.underline ?? false;
    if (style.href) {
      if (!style.color) textColor = '#1155cc';
      if (style.underline === undefined) showUnderline = true;
    }

    this.ctx.font = buildFont(
      renderFontSize,
      style.fontFamily,
      style.bold,
      style.italic,
    );
    this.ctx.fillStyle = textColor;
    this.ctx.textBaseline = 'alphabetic';

    let baselineY = Math.round(lineY + (lineHeight + originalFontSizePx * 0.8) / 2);
    if (isSuperscript) {
      baselineY -= Math.round(originalFontSizePx * 0.4);
    } else if (isSubscript) {
      baselineY += Math.round(originalFontSizePx * 0.2);
    }
    const x = Math.round(lineX + run.x);

    if (style.backgroundColor) {
      this.ctx.save();
      this.ctx.fillStyle = style.backgroundColor;
      this.ctx.fillRect(x, lineY, run.width, lineHeight);
      this.ctx.restore();
      this.ctx.fillStyle = textColor;
    }

    this.ctx.fillText(run.text, x, baselineY);

    if (showUnderline) {
      const underlineY = baselineY + 2;
      this.ctx.beginPath();
      this.ctx.strokeStyle = textColor;
      this.ctx.lineWidth = 1;
      this.ctx.moveTo(x, underlineY);
      this.ctx.lineTo(x + run.width, underlineY);
      this.ctx.stroke();
    }

    if (style.strikethrough) {
      const renderFontSizePx = ptToPx(
        (isSuperscript || isSubscript)
          ? (style.fontSize ?? Theme.defaultFontSize) * 0.6
          : (style.fontSize ?? Theme.defaultFontSize),
      );
      const strikeY = Math.round(baselineY - renderFontSizePx * 0.3);
      this.ctx.beginPath();
      this.ctx.strokeStyle = textColor;
      this.ctx.lineWidth = 1;
      this.ctx.moveTo(x, strikeY);
      this.ctx.lineTo(x + run.width, strikeY);
      this.ctx.stroke();
    }
  }

  /**
   * Render a list marker (bullet or number) for a list-item block.
   */
  private renderListMarker(
    block: Block,
    lineY: number,
    lineHeight: number,
    markerX: number,
    markerText: string,
  ): void {
    const fontSize = block.inlines[0]?.style.fontSize ?? Theme.defaultFontSize;
    const fontSizePx = ptToPx(fontSize);
    const baselineY = Math.round(lineY + (lineHeight + fontSizePx * 0.8) / 2);
    this.ctx.font = buildFont(fontSize, block.inlines[0]?.style.fontFamily, false, false);
    this.ctx.fillStyle = block.inlines[0]?.style.color ?? Theme.defaultColor;
    this.ctx.fillText(markerText, markerX, baselineY);
  }

  /**
   * Resize the canvas to fill its container.
   */
  resize(width: number, height: number): void {
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = width * dpr;
    this.canvas.height = height * dpr;
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;
    this.ctx.scale(dpr, dpr);
  }
}
