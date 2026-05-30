import { LIST_INDENT_PX, UNORDERED_MARKERS } from '../model/types.js';
import type { PaginatedLayout, LayoutPage } from './pagination.js';
import { getPageYOffset, getPageXOffset, getHeaderYStart, getFooterYStart, getTableOriginYForPageLine } from './pagination.js';
import type { EditContext } from '../model/document.js';
import type { DocumentLayout, LayoutBlock, LayoutRun } from './layout.js';
import { computeListCounters } from './layout.js';
import { Theme } from './theme.js';
import { drawPeerCaret, drawPeerLabel } from './peer-cursor.js';
import { renderTableBackgrounds, renderTableContent } from './table-renderer.js';
import { computeTableRangeForPageLine } from './table-geometry.js';
import { getOrLoadImage } from './image-cache.js';
import { drawImageSelection, drawResizeHud, type ImageRect } from './image-selection-overlay.js';
import {
  renderRun as paintRenderRun,
  renderListMarker as paintRenderListMarker,
  drawInlineRunBackgroundsForPage,
} from './paint-layout.js';

/**
 * Convert a peer cursor color (hex) to a translucent selection fill.
 */
function peerColorToSelectionColor(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, 0.2)`;
}

export interface TableRenderRange {
  layoutBlock: LayoutBlock;
  tableX: number;
  tableOriginY: number;
  pageStartRow: number;
  renderStartRow: number;
  endRowIndex: number;
  rowSplitOffset?: number;
  rowSplitHeight?: number;
}

/**
 * Decide whether the PageLine at `plIndex` should kick off a fresh
 * table render pass on this page. Both the background pre-pass
 * (`collectTableRenderRanges`) and the body content pass call this so
 * they stay in lockstep — divergence would produce backgrounds without
 * borders/text or vice versa.
 *
 * A render starts when:
 * - it's the first PageLine on the page, OR
 * - the previous PageLine belonged to a different block, OR
 * - this PageLine is a split fragment (always renders on its own), OR
 * - the previous PageLine was a split fragment of the same block —
 *   that prior render only covered its own row (the sweep in
 *   `computeTableRangeForPageLine` is suppressed for split fragments),
 *   so the follow-up rows need their own sweep here, otherwise they
 *   would be silently skipped.
 */
export function shouldStartTableRender(page: LayoutPage, plIndex: number): boolean {
  if (plIndex === 0) return true;
  const pl = page.lines[plIndex];
  const prev = page.lines[plIndex - 1];
  if (prev.blockIndex !== pl.blockIndex) return true;
  if (pl.rowSplitOffset !== undefined) return true;
  if (prev.rowSplitOffset !== undefined) return true;
  return false;
}

/**
 * Collect render args for every table block that has at least one row
 * on this page. Returns one entry per table (deduped across PageLines)
 * so the background pre-pass touches each table once per page.
 */
export function collectTableRenderRanges(
  page: LayoutPage,
  layout: DocumentLayout,
  pageX: number,
  pageY: number,
  margins: { left: number; right: number; top: number; bottom: number },
): TableRenderRange[] {
  const ranges: TableRenderRange[] = [];
  for (let plIndex = 0; plIndex < page.lines.length; plIndex++) {
    if (!shouldStartTableRender(page, plIndex)) continue;
    const pl = page.lines[plIndex];
    const lb = layout.blocks[pl.blockIndex];
    if (!lb || lb.block.type !== 'table' || !lb.layoutTable || !lb.block.tableData) {
      continue;
    }
    const range = computeTableRangeForPageLine(page, lb, pl, plIndex);
    const tableOriginY = getTableOriginYForPageLine(pageY, pl, lb.layoutTable.rowYOffsets);
    ranges.push({
      layoutBlock: lb,
      tableX: pageX + margins.left,
      tableOriginY,
      pageStartRow: range.pageStartRow,
      renderStartRow: range.renderStartRow,
      endRowIndex: range.endRowIndex,
      rowSplitOffset: pl.rowSplitOffset,
      rowSplitHeight: pl.rowSplitHeight,
    });
  }
  return ranges;
}

/**
 * Canvas rendering engine for the document editor.
 * Paints paginated pages with shadows, styled text runs, cursor, and selection highlights.
 */
export class DocCanvas {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  /**
   * Optional re-render trigger invoked after async resources (e.g. inline
   * images) finish loading. Set by the owning editor via
   * {@link setRequestRender}. Null while not wired (tests, headless use).
   */
  private requestRender: (() => void) | null = null;

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
   * Register a callback used to trigger a re-render when asynchronous
   * resources (currently inline images) finish loading.
   */
  setRequestRender(cb: () => void): void {
    this.requestRender = cb;
  }

  /**
   * Render the full paginated document.
   */
  render(
    paginatedLayout: PaginatedLayout,
    scrollY: number,
    canvasWidth: number,
    viewportHeight: number,
    cursor?: { x: number; y: number; height: number; visible: boolean; color?: string },
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
    headerLayout?: DocumentLayout | null,
    footerLayout?: DocumentLayout | null,
    headerFooter?: { header?: { marginFromEdge: number }; footer?: { marginFromEdge: number } },
    editContext?: EditContext,
    headerCursor?: { x: number; y: number; height: number; visible: boolean; color?: string },
    footerCursor?: { x: number; y: number; height: number; visible: boolean; color?: string },
    hfSelectionRects?: Array<{ x: number; y: number; width: number; height: number }>,
    imageSelectionRect?: ImageRect,
    imageResizeHudText?: string,
    /**
     * When an image resize drag is active, the caller passes the
     * LayoutRun of the image being dragged. The normal content pass
     * skips drawing it at its committed (pre-drag) size, and a final
     * shadow-lift pass draws it at `imageSelectionRect` (which is the
     * preview rect during drag). The result feels like the image is
     * being physically scaled under the cursor instead of the
     * overlay floating off the committed image.
     */
    dragImageRun?: LayoutRun,
    /**
     * Yellow highlight rectangles for comment markers. Drawn in the same
     * z-order pass as search matches (behind selections, above inline
     * backgrounds). Comment-naive — the canvas does not interpret the ids.
     */
    commentMarkers?: ReadonlyArray<{
      id: string;
      x: number;
      y: number;
      width: number;
      height: number;
    }>,
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

      // Content area dimensions
      const contentX = pageX + margins.left;
      const contentY = pageY + margins.top;
      const contentWidth = page.width - margins.left - margins.right;
      const contentHeight = page.height - margins.top - margins.bottom;

      // Draw header
      if (headerLayout && headerFooter?.header) {
        const hfMargin = headerFooter.header.marginFromEdge;
        const headerY = getHeaderYStart(paginatedLayout, page.pageIndex, hfMargin);
        const headerClipHeight = margins.top - hfMargin;

        this.ctx.save();
        this.ctx.beginPath();
        this.ctx.rect(contentX, pageY + hfMargin, contentWidth, headerClipHeight);
        this.ctx.clip();

        // Draw header selection highlights
        if (editContext === 'header' && hfSelectionRects) {
          this.ctx.fillStyle = Theme.selectionColor;
          for (const rect of hfSelectionRects) {
            if (rect.y + rect.height > pageY && rect.y < pageY + page.height) {
              this.ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
            }
          }
        }

        for (const lb of headerLayout.blocks) {
          for (const line of lb.lines) {
            for (const run of line.runs) {
              this.renderRunWithPageNumber(
                run, contentX, headerY + lb.y + line.y, line.height,
                page.pageIndex + 1,
              );
            }
          }
        }

        if (editContext === 'header' && headerCursor?.visible) {
          this.ctx.fillStyle = headerCursor.color ?? Theme.cursorColor;
          this.ctx.fillRect(headerCursor.x, headerCursor.y, Theme.cursorWidth, headerCursor.height);
        }

        this.ctx.restore();

        if (editContext === 'header') {
          // Draw separator line between header and body
          const lineY = pageY + margins.top;
          this.ctx.save();
          this.ctx.strokeStyle = Theme.headerFooterBorderColor;
          this.ctx.lineWidth = 1;
          this.ctx.beginPath();
          this.ctx.moveTo(pageX, lineY);
          this.ctx.lineTo(pageX + page.width, lineY);
          this.ctx.stroke();
          this.ctx.restore();
        }
      }

      // Draw footer
      if (footerLayout && headerFooter?.footer) {
        const fMargin = headerFooter.footer.marginFromEdge;
        const footerTotalH = footerLayout.totalHeight;
        const footerY = getFooterYStart(paginatedLayout, page.pageIndex, footerTotalH, fMargin);
        const footerClipY = pageY + page.height - margins.bottom;
        const footerClipHeight = margins.bottom - fMargin;

        this.ctx.save();
        this.ctx.beginPath();
        this.ctx.rect(contentX, footerClipY, contentWidth, footerClipHeight);
        this.ctx.clip();

        // Draw footer selection highlights
        if (editContext === 'footer' && hfSelectionRects) {
          this.ctx.fillStyle = Theme.selectionColor;
          for (const rect of hfSelectionRects) {
            if (rect.y + rect.height > pageY && rect.y < pageY + page.height) {
              this.ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
            }
          }
        }

        for (const lb of footerLayout.blocks) {
          for (const line of lb.lines) {
            for (const run of line.runs) {
              this.renderRunWithPageNumber(
                run, contentX, footerY + lb.y + line.y, line.height,
                page.pageIndex + 1,
              );
            }
          }
        }

        if (editContext === 'footer' && footerCursor?.visible) {
          this.ctx.fillStyle = footerCursor.color ?? Theme.cursorColor;
          this.ctx.fillRect(footerCursor.x, footerCursor.y, Theme.cursorWidth, footerCursor.height);
        }

        this.ctx.restore();

        if (editContext === 'footer') {
          // Draw separator line between body and footer
          const lineY = pageY + page.height - margins.bottom;
          this.ctx.save();
          this.ctx.strokeStyle = Theme.headerFooterBorderColor;
          this.ctx.lineWidth = 1;
          this.ctx.beginPath();
          this.ctx.moveTo(pageX, lineY);
          this.ctx.lineTo(pageX + page.width, lineY);
          this.ctx.stroke();
          this.ctx.restore();
        }
      }

      // Clip to content area
      this.ctx.save();
      if (editContext === 'header' || editContext === 'footer') {
        this.ctx.globalAlpha = Theme.headerFooterDimAlpha;
      }
      this.ctx.beginPath();
      this.ctx.rect(contentX, contentY, contentWidth, contentHeight);
      this.ctx.clip();

      // Draw table cell backgrounds FIRST, before any highlight layer.
      // Cell backgrounds are opaque fillRects that would otherwise cover
      // the translucent selection highlight and hide it inside colored
      // cells. Splitting the table render into a background pass here
      // plus a content pass in the text loop below keeps the selection
      // overlay visible.
      if (layout) {
        const tableRanges = collectTableRenderRanges(page, layout, pageX, pageY, margins);
        for (const tr of tableRanges) {
          renderTableBackgrounds(
            this.ctx,
            tr.layoutBlock.block.tableData!,
            tr.layoutBlock.layoutTable!,
            tr.tableX,
            tr.tableOriginY,
            tr.renderStartRow,
            tr.endRowIndex,
            tr.pageStartRow,
            tr.rowSplitOffset,
            tr.rowSplitHeight,
          );
        }
      }

      // Draw inline run backgrounds for body paragraphs in the same
      // background pass as table cells, so the selection / search /
      // peer highlight layers below sit on top of them. Without this,
      // renderRun's opaque bg fillRect would later paint over the
      // translucent highlights and hide them inside a colored span.
      drawInlineRunBackgroundsForPage(this.ctx, page, layout, pageX, pageY);

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

      // Draw comment marker highlights for this page (same z-order as
      // search matches). Background + 1px underline at the bottom edge
      // (Google Docs parity).
      if (commentMarkers) {
        for (const rect of commentMarkers) {
          if (rect.y + rect.height <= pageY || rect.y >= pageY + page.height) continue;
          this.ctx.fillStyle = 'rgba(251, 188, 4, 0.25)';
          this.ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
          this.ctx.fillStyle = '#fbbc04';
          this.ctx.fillRect(rect.x, rect.y + rect.height - 1, rect.width, 1);
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

      // Draw text. Iterate via index rather than for-of so the table
      // branch below can reuse the loop index instead of calling
      // page.lines.indexOf(pl), which would turn this hot render path
      // into O(n^2) on pages with many table rows.
      for (let plIndex = 0; plIndex < page.lines.length; plIndex++) {
        const pl = page.lines[plIndex];
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
            // Mirror the predicate used by `collectTableRenderRanges`
            // (background pass) so backgrounds and content stay in
            // lockstep.
            if (shouldStartTableRender(page, plIndex)) {
              const range = computeTableRangeForPageLine(page, lb, pl, plIndex);
              const tableOriginY = getTableOriginYForPageLine(pageY, pl, lb.layoutTable.rowYOffsets);
              renderTableContent(
                this.ctx,
                lb.block.tableData,
                lb.layoutTable,
                pageX + margins.left,
                tableOriginY,
                range.renderStartRow,
                range.endRowIndex,
                range.pageStartRow,
                this.requestRender ?? undefined,
                dragImageRun,
                selectionRects,
                focused,
                pl.rowSplitOffset,
                pl.rowSplitHeight,
              );
            }
            continue;
          }
        }

        for (const run of pl.line.runs) {
          // Skip the image run that's currently being resized — it's
          // drawn in a later pass at the preview rect with a lift
          // shadow, so that the overlay handles and the image stay in
          // lockstep instead of visually diverging during the drag.
          if (dragImageRun && run === dragImageRun) continue;
          paintRenderRun(this.ctx, run, pageX + pl.x, pageY + pl.y, pl.line.height, {
            theme: Theme,
            skipBackground: true,
            requestRender: this.requestRender ?? undefined,
          });

          // Image runs are opaque and cover the selection highlight
          // drawn earlier. Re-draw a semi-transparent overlay on top
          // of the image when it intersects the selection, so that
          // selected images show a visible blue tint.
          if (run.inline.style.image && selectionRects) {
            const ix = Math.round(pageX + pl.x + run.x);
            const drawH = run.imageHeight ?? pl.line.height;
            const iy = Math.round(pageY + pl.y + pl.line.height - drawH);
            const iw = run.width;
            const ih = drawH;
            for (const sr of selectionRects) {
              if (sr.x < ix + iw && sr.x + sr.width > ix &&
                  sr.y < iy + ih && sr.y + sr.height > iy) {
                this.ctx.fillStyle = focused ? Theme.selectionColor : Theme.selectionColorInactive;
                this.ctx.fillRect(ix, iy, iw, ih);
                break;
              }
            }
          }
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
            paintRenderListMarker(this.ctx, block, pageY + pl.y, pl.line.height, markerX, marker, Theme);
          }
        }
      }

      // Draw cursor if on this page (only when focused).
      // When an image is selected the text caret is suppressed — the
      // selection overlay stands in for the caret and showing both
      // would read as "insertion point is inside the image" which is
      // misleading.
      if (focused && cursor?.visible && !imageSelectionRect) {
        if (cursor.y >= pageY + margins.top &&
            cursor.y < pageY + margins.top + contentHeight) {
          this.ctx.fillStyle = cursor.color ?? Theme.cursorColor;
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

    // Drag-lift pass: if the user is resizing an image, render it at
    // the preview rect with a soft drop shadow so it feels lifted
    // off the page. Drawn before the selection rect so the overlay
    // and handles paint on top of both the image and its shadow.
    if (dragImageRun && imageSelectionRect) {
      const imgStyle = dragImageRun.inline.style.image;
      if (imgStyle) {
        const img = getOrLoadImage(imgStyle.src, () => {
          this.requestRender?.();
        });
        if (img) {
          this.ctx.save();
          this.ctx.shadowColor = 'rgba(0, 0, 0, 0.30)';
          this.ctx.shadowBlur = 16;
          this.ctx.shadowOffsetX = 0;
          this.ctx.shadowOffsetY = 4;
          this.ctx.drawImage(
            img,
            imageSelectionRect.x,
            imageSelectionRect.y,
            imageSelectionRect.width,
            imageSelectionRect.height,
          );
          this.ctx.restore();
        }
      }
    }

    // Image selection overlay — drawn after every page's content so it
    // sits on top of whichever image run is currently selected.
    // `imageSelectionRect` is already in document-layout coordinates,
    // matching the translation that's still active on the context.
    // The optional HUD renders after the handles so the pill sits
    // above the se handle instead of getting clipped by it.
    if (imageSelectionRect) {
      drawImageSelection(this.ctx, imageSelectionRect);
      if (imageResizeHudText) {
        drawResizeHud(this.ctx, imageSelectionRect, imageResizeHudText);
      }
    }

    // Restore the scrollY translation
    this.ctx.restore();
  }

  /**
   * Render a header/footer run, substituting the page number token if
   * applicable. Header/footer paths predate the body's two-pass
   * background pipeline, so this passes `skipBackground: false` to
   * paint each run's bg fill inline.
   */
  private renderRunWithPageNumber(
    run: LayoutRun,
    lineX: number,
    lineY: number,
    lineHeight: number,
    pageNumber: number,
  ): void {
    const target = run.inline.style.pageNumber
      ? {
          ...run,
          text: String(pageNumber),
          inline: { ...run.inline, text: String(pageNumber) },
        }
      : run;
    paintRenderRun(this.ctx, target, lineX, lineY, lineHeight, {
      theme: Theme,
      skipBackground: false,
      requestRender: this.requestRender ?? undefined,
    });
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
