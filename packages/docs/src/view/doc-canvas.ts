import type { PaginatedLayout } from './pagination.js';
import { getPageYOffset, getPageXOffset } from './pagination.js';
import type { LayoutRun } from './layout.js';
import { Theme, buildFont, ptToPx } from './theme.js';
import { drawPeerCaret, drawPeerLabel } from './peer-cursor.js';

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
  ): void {
    const dpr = window.devicePixelRatio || 1;
    const logicalWidth = this.canvas.width / dpr;
    const logicalHeight = this.canvas.height / dpr;

    // Clear with canvas background
    this.ctx.fillStyle = Theme.canvasBackground;
    this.ctx.fillRect(0, 0, logicalWidth, logicalHeight);

    const pageX = getPageXOffset(paginatedLayout, canvasWidth);
    const { margins } = paginatedLayout.pageSetup;

    // Canvas is viewport-sized. Translate by -scrollY so that absolute
    // document coordinates map into the visible canvas area.
    const visibleTop = scrollY;
    const visibleBottom = scrollY + viewportHeight;

    this.ctx.save();
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

      // Draw selection highlights for this page
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
        for (const run of pl.line.runs) {
          this.renderRun(run, pageX + pl.x, pageY + pl.y, pl.line.height);
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
    this.ctx.font = buildFont(
      style.fontSize,
      style.fontFamily,
      style.bold,
      style.italic,
    );
    this.ctx.fillStyle = style.color ?? Theme.defaultColor;
    this.ctx.textBaseline = 'alphabetic';

    const fontSizePx = ptToPx(style.fontSize ?? Theme.defaultFontSize);
    const baselineY = Math.round(lineY + (lineHeight + fontSizePx * 0.8) / 2);
    const x = Math.round(lineX + run.x);

    this.ctx.fillText(run.text, x, baselineY);

    if (style.underline) {
      const underlineY = baselineY + 2;
      this.ctx.beginPath();
      this.ctx.strokeStyle = style.color ?? Theme.defaultColor;
      this.ctx.lineWidth = 1;
      this.ctx.moveTo(x, underlineY);
      this.ctx.lineTo(x + run.width, underlineY);
      this.ctx.stroke();
    }

    if (style.strikethrough) {
      const strikeY = Math.round(lineY + lineHeight / 2);
      this.ctx.beginPath();
      this.ctx.strokeStyle = style.color ?? Theme.defaultColor;
      this.ctx.lineWidth = 1;
      this.ctx.moveTo(x, strikeY);
      this.ctx.lineTo(x + run.width, strikeY);
      this.ctx.stroke();
    }
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
