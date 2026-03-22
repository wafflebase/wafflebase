import type { PaginatedLayout, LayoutPage } from './pagination.js';
import { getPageXOffset, getPageYOffset } from './pagination.js';
import type { BlockStyle, PageMargins } from '../model/types.js';

export type RulerUnit = 'inch' | 'cm';

export interface GridConfig {
  majorStepPx: number;
  subdivisions: number;
  minorStepPx: number;
}

const INCH_LOCALES = ['en-US', 'en-GB', 'my'];

export function detectUnit(locale: string | undefined): RulerUnit {
  if (!locale) return 'inch';
  if (INCH_LOCALES.some((l) => locale.startsWith(l.split('-')[0]) && locale === l)) {
    return 'inch';
  }
  if (locale.startsWith('en')) return 'inch';
  return 'cm';
}

export function getGridConfig(unit: RulerUnit): GridConfig {
  if (unit === 'inch') {
    return { majorStepPx: 96, subdivisions: 8, minorStepPx: 12 };
  }
  const cmPx = 96 / 2.54;
  return { majorStepPx: cmPx, subdivisions: 10, minorStepPx: cmPx / 10 };
}

export function snapToGrid(px: number, step: number): number {
  return Math.round(px / step) * step;
}

export const RULER_SIZE = 20;
const TICK_MAJOR = 10;
const TICK_HALF = 7;
const TICK_MINOR = 4;
const MARGIN_BG = '#e8e8e8';
const CONTENT_BG = '#ffffff';
const TICK_COLOR = '#666666';
const LABEL_FONT = '9px Arial';
const HIT_ZONE = 4;

export class Ruler {
  private hCanvas: HTMLCanvasElement;
  private vCanvas: HTMLCanvasElement;
  private corner: HTMLDivElement;
  private hCtx: CanvasRenderingContext2D;
  private vCtx: CanvasRenderingContext2D;
  private unit: RulerUnit;
  private grid: GridConfig;

  // Drag state (stubs for now)
  private dragging: string | null = null;

  // Callbacks
  private marginChangeCb?: (margins: PageMargins) => void;
  private indentChangeCb?: (style: Partial<BlockStyle>) => void;
  private dragGuidelineCb?: (position: { x?: number; y?: number } | null) => void;

  // Cached layout info for hit testing
  private cachedPageX = 0;
  private cachedMargins: PageMargins = { top: 0, bottom: 0, left: 0, right: 0 };
  private cachedPageWidth = 0;
  private cachedPageHeight = 0;
  private cachedBlockStyle: BlockStyle | null = null;
  private cachedVContentTop = 0;
  private cachedVContentBottom = 0;

  // Event handler references for cleanup
  private boundHandlers: Array<[EventTarget, string, EventListener]> = [];

  constructor(container: HTMLElement, docCanvas: HTMLCanvasElement) {
    const doc = typeof document !== 'undefined' ? document : null;

    // Create corner element
    this.corner = (doc?.createElement('div') ?? { style: {} }) as HTMLDivElement;
    if (doc) {
      this.corner.style.cssText = `position:sticky;top:0;left:0;width:${RULER_SIZE}px;height:${RULER_SIZE}px;z-index:3;background:${MARGIN_BG};flex-shrink:0;`;
    }

    // Create horizontal ruler canvas
    this.hCanvas = (doc?.createElement('canvas') ?? { style: {}, getContext: () => null }) as HTMLCanvasElement;
    if (doc) {
      this.hCanvas.style.cssText = `display:block;position:sticky;top:0;z-index:2;height:${RULER_SIZE}px;`;
    }

    // Create vertical ruler canvas
    this.vCanvas = (doc?.createElement('canvas') ?? { style: {}, getContext: () => null }) as HTMLCanvasElement;
    if (doc) {
      this.vCanvas.style.cssText = `display:block;position:sticky;left:0;z-index:1;width:${RULER_SIZE}px;`;
    }

    this.hCtx = (this.hCanvas.getContext?.('2d') ?? {}) as CanvasRenderingContext2D;
    this.vCtx = (this.vCanvas.getContext?.('2d') ?? {}) as CanvasRenderingContext2D;

    // Insert before doc canvas
    if (doc) {
      container.insertBefore(this.corner, docCanvas);
      container.insertBefore(this.hCanvas, docCanvas);
      container.insertBefore(this.vCanvas, docCanvas);
    }

    // Shift doc canvas down
    docCanvas.style.top = `${RULER_SIZE}px`;

    // Detect unit from locale
    this.unit = detectUnit(typeof navigator !== 'undefined' ? navigator?.language : undefined);
    this.grid = getGridConfig(this.unit);
  }

  render(
    paginatedLayout: PaginatedLayout,
    scrollY: number,
    canvasWidth: number,
    viewportHeight: number,
    cursorBlockStyle: BlockStyle | null,
  ): void {
    if (paginatedLayout.pages.length === 0) return;

    const page = paginatedLayout.pages[0];
    const pageX = getPageXOffset(paginatedLayout, canvasWidth);
    const margins = paginatedLayout.pageSetup.margins;

    this.cachedPageX = pageX;
    this.cachedMargins = margins;
    this.cachedPageWidth = page.width;
    this.cachedPageHeight = page.height;
    this.cachedBlockStyle = cursorBlockStyle;

    this.resizeH(canvasWidth);
    this.renderHorizontal(pageX, page.width, margins, cursorBlockStyle);
    this.resizeV(viewportHeight);
    this.renderVertical(scrollY, viewportHeight, paginatedLayout);
  }

  private renderHorizontal(
    pageX: number,
    pageWidth: number,
    margins: PageMargins,
    blockStyle: BlockStyle | null,
  ): void {
    const ctx = this.hCtx;
    const totalWidth = this.hCanvas.width / (typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1);

    // 1. Fill entire ruler with margin background
    ctx.fillStyle = MARGIN_BG;
    ctx.fillRect(0, 0, totalWidth, RULER_SIZE);

    // 2. Fill content area with white background
    const contentLeft = pageX + margins.left;
    const contentRight = pageX + pageWidth - margins.right;
    ctx.fillStyle = CONTENT_BG;
    ctx.fillRect(contentLeft, 0, contentRight - contentLeft, RULER_SIZE);

    // 3. Draw tick marks from page left to page right
    ctx.strokeStyle = TICK_COLOR;
    ctx.lineWidth = 1;
    ctx.fillStyle = TICK_COLOR;
    ctx.font = LABEL_FONT;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';

    const { majorStepPx, subdivisions, minorStepPx } = this.grid;
    const halfStep = majorStepPx / 2;

    // Calculate the first tick index from page start
    const pageLeft = pageX;
    const pageRight = pageX + pageWidth;

    // Draw ticks from page left to page right
    const startTick = 0;
    const endTick = Math.ceil(pageWidth / minorStepPx);

    ctx.beginPath();
    for (let i = startTick; i <= endTick; i++) {
      const xRaw = pageLeft + i * minorStepPx;
      if (xRaw < pageLeft || xRaw > pageRight) continue;
      const x = Math.round(xRaw) + 0.5;

      let tickHeight: number;
      if (i % subdivisions === 0) {
        tickHeight = TICK_MAJOR;
      } else if (i % (subdivisions / 2) === 0) {
        tickHeight = TICK_HALF;
      } else {
        tickHeight = TICK_MINOR;
      }

      ctx.moveTo(x, RULER_SIZE);
      ctx.lineTo(x, RULER_SIZE - tickHeight);

      // Draw label at major ticks
      if (i % subdivisions === 0 && i > 0) {
        const labelValue = this.unit === 'inch'
          ? i / subdivisions
          : Math.round(i * minorStepPx / (this.grid.majorStepPx / subdivisions) / subdivisions * 10) / 10;
        const labelText = this.unit === 'inch'
          ? String(i / subdivisions)
          : String(Math.round(i * minorStepPx * subdivisions / majorStepPx));
        ctx.fillText(labelText, x, 1);
      }
    }
    ctx.stroke();

    // 4. Draw indent handles if blockStyle is available
    if (blockStyle !== null) {
      const firstLineX = contentLeft + blockStyle.textIndent;
      const leftIndentX = contentLeft + blockStyle.marginLeft;
      this.drawDownTriangle(ctx, firstLineX, RULER_SIZE - 1);
      this.drawUpTriangle(ctx, leftIndentX, RULER_SIZE - 1);
    }
  }

  private drawDownTriangle(ctx: CanvasRenderingContext2D, x: number, baseY: number): void {
    const size = 5;
    ctx.fillStyle = TICK_COLOR;
    ctx.beginPath();
    ctx.moveTo(x - size / 2, baseY - size);
    ctx.lineTo(x + size / 2, baseY - size);
    ctx.lineTo(x, baseY);
    ctx.closePath();
    ctx.fill();
  }

  private drawUpTriangle(ctx: CanvasRenderingContext2D, x: number, baseY: number): void {
    const size = 5;
    ctx.fillStyle = TICK_COLOR;
    ctx.beginPath();
    ctx.moveTo(x - size / 2, baseY);
    ctx.lineTo(x + size / 2, baseY);
    ctx.lineTo(x, baseY - size);
    ctx.closePath();
    ctx.fill();
  }

  private resizeH(width: number): void {
    const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
    this.hCanvas.width = width * dpr;
    this.hCanvas.height = RULER_SIZE * dpr;
    this.hCanvas.style.width = `${width}px`;
    this.hCanvas.style.height = `${RULER_SIZE}px`;
    this.hCtx.scale(dpr, dpr);
  }

  private findFocusedPage(
    scrollY: number,
    viewportHeight: number,
    paginatedLayout: PaginatedLayout,
  ): LayoutPage {
    const center = scrollY + viewportHeight / 2;
    let closest = paginatedLayout.pages[0];
    let minDist = Infinity;
    for (const page of paginatedLayout.pages) {
      const pageY = getPageYOffset(paginatedLayout, page.pageIndex);
      const pageMid = pageY + page.height / 2;
      const dist = Math.abs(pageMid - center);
      if (dist < minDist) {
        minDist = dist;
        closest = page;
      }
    }
    return closest;
  }

  private renderVertical(
    scrollY: number,
    viewportHeight: number,
    paginatedLayout: PaginatedLayout,
  ): void {
    const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
    const h = this.vCanvas.height / dpr;

    this.vCtx.save();
    this.vCtx.fillStyle = MARGIN_BG;
    this.vCtx.fillRect(0, 0, RULER_SIZE, h);

    if (paginatedLayout.pages.length === 0) {
      this.vCtx.restore();
      return;
    }

    const focusedPage = this.findFocusedPage(scrollY, viewportHeight, paginatedLayout);
    const pageY = getPageYOffset(paginatedLayout, focusedPage.pageIndex);
    const margins = paginatedLayout.pageSetup.margins;

    // Map to viewport-relative coordinates
    const pageTopInViewport = pageY - scrollY;
    const contentTop = pageTopInViewport + margins.top;
    const contentBottom = pageTopInViewport + focusedPage.height - margins.bottom;

    // Cache for vertical hit testing
    this.cachedVContentTop = contentTop;
    this.cachedVContentBottom = contentBottom;

    // Content area
    this.vCtx.fillStyle = CONTENT_BG;
    this.vCtx.fillRect(0, contentTop, RULER_SIZE, contentBottom - contentTop);

    // Tick marks
    const { majorStepPx, subdivisions, minorStepPx } = this.grid;
    const startPx = pageTopInViewport;
    const endPx = pageTopInViewport + focusedPage.height;

    this.vCtx.strokeStyle = TICK_COLOR;
    this.vCtx.fillStyle = TICK_COLOR;
    this.vCtx.font = LABEL_FONT;
    this.vCtx.textAlign = 'center';
    this.vCtx.textBaseline = 'middle';
    this.vCtx.lineWidth = 1;

    for (let px = startPx; px <= endPx; px += minorStepPx) {
      const relPx = px - startPx;
      const tickIndex = Math.round(relPx / minorStepPx);
      const isMajor = tickIndex % subdivisions === 0;
      const isHalf = tickIndex % (subdivisions / 2) === 0;
      const tickW = isMajor ? TICK_MAJOR : isHalf ? TICK_HALF : TICK_MINOR;
      const y = Math.round(px) + 0.5;

      this.vCtx.beginPath();
      this.vCtx.moveTo(RULER_SIZE, y);
      this.vCtx.lineTo(RULER_SIZE - tickW, y);
      this.vCtx.stroke();

      if (isMajor && tickIndex > 0) {
        this.vCtx.save();
        this.vCtx.translate(6, y);
        this.vCtx.rotate(-Math.PI / 2);
        this.vCtx.fillText(String(tickIndex / subdivisions), 0, 0);
        this.vCtx.restore();
      }
    }

    this.vCtx.restore();
  }

  private resizeV(height: number): void {
    const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
    this.vCanvas.width = RULER_SIZE * dpr;
    this.vCanvas.height = height * dpr;
    this.vCanvas.style.width = `${RULER_SIZE}px`;
    this.vCanvas.style.height = `${height}px`;
    this.vCtx.scale(dpr, dpr);
  }

  onMarginChange(cb: (margins: PageMargins) => void): void {
    this.marginChangeCb = cb;
  }

  onIndentChange(cb: (style: Partial<BlockStyle>) => void): void {
    this.indentChangeCb = cb;
  }

  onDragGuideline(cb: (position: { x?: number; y?: number } | null) => void): void {
    this.dragGuidelineCb = cb;
  }

  dispose(): void {
    for (const [target, event, handler] of this.boundHandlers) {
      target.removeEventListener(event, handler);
    }
    this.boundHandlers = [];
    this.hCanvas.remove?.();
    this.vCanvas.remove?.();
    this.corner.remove?.();
  }
}
