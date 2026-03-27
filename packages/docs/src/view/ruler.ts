import type { PaginatedLayout } from './pagination.js';
import { getPageXOffset, getPageYOffset, getTotalHeight } from './pagination.js';
import type { BlockStyle, PageMargins } from '../model/types.js';
import { Theme } from './theme.js';

export type RulerUnit = 'inch' | 'cm';

export interface GridConfig {
  majorStepPx: number;
  subdivisions: number;
  minorStepPx: number;
}

const INCH_LOCALES = ['en-US', 'en-GB', 'my'];

export function detectUnit(locale: string | undefined): RulerUnit {
  if (!locale) return 'inch';
  if (INCH_LOCALES.includes(locale)) return 'inch';
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
// Colors are read from the active theme at render time.
const marginBg = () => Theme.rulerMarginBackground;
const contentBg = () => Theme.rulerContentBackground;
const tickColor = () => Theme.rulerTickColor;
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

  // Drag state
  private dragging: 'left-margin' | 'right-margin' | 'top-margin' | 'bottom-margin' | 'text-indent' | 'margin-left' | null = null;
  private dragStartPx = 0;
  private dragCurrentPx = 0;

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

  constructor(container: HTMLElement, docCanvas: HTMLCanvasElement, readOnly?: boolean) {
    const doc = typeof document !== 'undefined' ? document : null;

    // Corner element: collapses into hRuler's space via negative margin
    this.corner = (doc?.createElement('div') ?? { style: {} }) as HTMLDivElement;
    if (doc) {
      this.corner.style.cssText =
        `position:sticky;top:0;left:0;width:${RULER_SIZE}px;height:${RULER_SIZE}px;`
        + `z-index:3;background:${marginBg()};margin-bottom:${-RULER_SIZE}px;`;
    }

    // Horizontal ruler: takes 20px in flow so doc canvas is pushed below it
    this.hCanvas = (doc?.createElement('canvas') ?? { style: {}, getContext: () => null }) as HTMLCanvasElement;
    if (doc) {
      this.hCanvas.style.cssText =
        `display:block;position:sticky;top:0;z-index:2;height:${RULER_SIZE}px;`;
    }

    // Vertical ruler: absolutely positioned, manually updated in render()
    this.vCanvas = (doc?.createElement('canvas') ?? { style: {}, getContext: () => null }) as HTMLCanvasElement;
    if (doc) {
      this.vCanvas.style.cssText =
        `display:block;position:absolute;left:0;top:${RULER_SIZE}px;z-index:1;`
        + `width:${RULER_SIZE}px;`;
    }

    this.hCtx = (this.hCanvas.getContext?.('2d') ?? {}) as CanvasRenderingContext2D;
    this.vCtx = (this.vCanvas.getContext?.('2d') ?? {}) as CanvasRenderingContext2D;

    // Insert before doc canvas
    if (doc) {
      container.insertBefore(this.corner, docCanvas);
      container.insertBefore(this.hCanvas, docCanvas);
      container.insertBefore(this.vCanvas, docCanvas);
    }

    // Doc canvas sticks below the horizontal ruler
    docCanvas.style.top = `${RULER_SIZE}px`;

    // Detect unit from locale
    this.unit = detectUnit(typeof navigator !== 'undefined' ? navigator?.language : undefined);
    this.grid = getGridConfig(this.unit);

    if (typeof document !== 'undefined' && !readOnly) {
      this.addMouseHandlers();
    }
  }

  render(
    paginatedLayout: PaginatedLayout,
    scrollY: number,
    canvasWidth: number,
    viewportHeight: number,
    cursorBlockStyle: BlockStyle | null,
    cursorPageIndex: number = 0,
  ): void {
    if (paginatedLayout.pages.length === 0) return;

    // Update corner background for theme changes
    this.corner.style.background = marginBg();

    const page = paginatedLayout.pages[cursorPageIndex] ?? paginatedLayout.pages[0];
    const pageX = getPageXOffset(paginatedLayout, canvasWidth);
    const margins = paginatedLayout.pageSetup.margins;

    this.cachedPageX = pageX;
    this.cachedMargins = margins;
    this.cachedPageWidth = page.width;
    this.cachedPageHeight = page.height;
    this.cachedBlockStyle = cursorBlockStyle;

    this.resizeH(canvasWidth);
    this.renderHorizontal(pageX, page.width, margins, cursorBlockStyle);

    // Position vCanvas to simulate sticky behavior (absolute + manual top).
    // Clamp height so the absolute element doesn't extend past the document
    // content — otherwise it grows scrollHeight, creating a feedback loop
    // where each scroll event adds RULER_SIZE px of extra scroll range.
    const vTop = scrollY + RULER_SIZE;
    const totalHeight = getTotalHeight(paginatedLayout);
    const vHeight = Math.max(0, Math.min(viewportHeight, totalHeight - vTop));
    this.vCanvas.style.top = `${vTop}px`;
    this.resizeV(vHeight);
    this.renderVertical(scrollY, paginatedLayout, cursorPageIndex);
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
    ctx.fillStyle = marginBg();
    ctx.fillRect(0, 0, totalWidth, RULER_SIZE);

    // 2. Fill content area with white background
    const contentLeft = pageX + margins.left;
    const contentRight = pageX + pageWidth - margins.right;
    ctx.fillStyle = contentBg();
    ctx.fillRect(contentLeft, 0, contentRight - contentLeft, RULER_SIZE);

    // 3. Draw tick marks from page left to page right
    ctx.strokeStyle = tickColor();
    ctx.lineWidth = 1;
    ctx.fillStyle = tickColor();
    ctx.font = LABEL_FONT;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';

    const { subdivisions, minorStepPx } = this.grid;

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
        ctx.fillText(String(i / subdivisions), x, 1);
      }
    }
    ctx.stroke();

    // 4. Draw indent handles if blockStyle is available
    if (blockStyle !== null) {
      const firstLineX = contentLeft + blockStyle.textIndent;
      const leftIndentX = contentLeft + blockStyle.marginLeft;
      // ▽ text-indent at top half of ruler
      this.drawDownTriangle(ctx, firstLineX, 6);
      // △ margin-left at bottom half of ruler
      this.drawUpTriangle(ctx, leftIndentX, RULER_SIZE - 1);
    }
  }

  private drawDownTriangle(ctx: CanvasRenderingContext2D, x: number, baseY: number): void {
    const size = 5;
    ctx.fillStyle = tickColor();
    ctx.beginPath();
    ctx.moveTo(x - size / 2, baseY - size);
    ctx.lineTo(x + size / 2, baseY - size);
    ctx.lineTo(x, baseY);
    ctx.closePath();
    ctx.fill();
  }

  private drawUpTriangle(ctx: CanvasRenderingContext2D, x: number, baseY: number): void {
    const size = 5;
    ctx.fillStyle = tickColor();
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

  private renderVertical(
    scrollY: number,
    paginatedLayout: PaginatedLayout,
    cursorPageIndex: number = 0,
  ): void {
    const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
    const h = this.vCanvas.height / dpr;

    this.vCtx.save();
    this.vCtx.fillStyle = marginBg();
    this.vCtx.fillRect(0, 0, RULER_SIZE, h);

    if (paginatedLayout.pages.length === 0) {
      this.vCtx.restore();
      return;
    }

    const focusedPage = paginatedLayout.pages[cursorPageIndex] ?? paginatedLayout.pages[0];
    const pageY = getPageYOffset(paginatedLayout, focusedPage.pageIndex);
    const margins = paginatedLayout.pageSetup.margins;

    // Map to viewport-relative coordinates (matches doc canvas coordinate system)
    const pageTopInViewport = pageY - scrollY;
    const contentTop = pageTopInViewport + margins.top;
    const contentBottom = pageTopInViewport + focusedPage.height - margins.bottom;

    // Cache for vertical hit testing
    this.cachedVContentTop = contentTop;
    this.cachedVContentBottom = contentBottom;

    // Content area
    this.vCtx.fillStyle = contentBg();
    this.vCtx.fillRect(0, contentTop, RULER_SIZE, contentBottom - contentTop);

    // Tick marks
    const { subdivisions, minorStepPx } = this.grid;
    const startPx = pageTopInViewport;
    const endPx = pageTopInViewport + focusedPage.height;

    this.vCtx.strokeStyle = tickColor();
    this.vCtx.fillStyle = tickColor();
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

  private getHitTarget(x: number, y: number, source: 'h' | 'v'): typeof this.dragging {
    if (source === 'h') {
      const leftMarginX = this.cachedPageX + this.cachedMargins.left;
      const rightMarginX = this.cachedPageX + this.cachedPageWidth - this.cachedMargins.right;

      // Check indent handles first (higher priority)
      if (this.cachedBlockStyle) {
        const indentX = leftMarginX + (this.cachedBlockStyle.textIndent ?? 0);
        const marginLeftX = leftMarginX + (this.cachedBlockStyle.marginLeft ?? 0);
        if (Math.abs(x - indentX) < HIT_ZONE && y < RULER_SIZE / 2) return 'text-indent';
        if (Math.abs(x - marginLeftX) < HIT_ZONE && y >= RULER_SIZE / 2) return 'margin-left';
      }

      if (Math.abs(x - leftMarginX) < HIT_ZONE) return 'left-margin';
      if (Math.abs(x - rightMarginX) < HIT_ZONE) return 'right-margin';
    } else {
      const contentTop = this.cachedVContentTop;
      const contentBottom = this.cachedVContentBottom;
      if (Math.abs(y - contentTop) < HIT_ZONE) return 'top-margin';
      if (Math.abs(y - contentBottom) < HIT_ZONE) return 'bottom-margin';
    }
    return null;
  }

  private addMouseHandlers(): void {
    const onHMouseDown = (e: MouseEvent) => {
      const rect = this.hCanvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const target = this.getHitTarget(x, y, 'h');
      if (target) {
        this.dragging = target;
        this.dragStartPx = x;
        this.dragCurrentPx = x;
        e.preventDefault();
      }
    };

    const onVMouseDown = (e: MouseEvent) => {
      const rect = this.vCanvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const target = this.getHitTarget(x, y, 'v');
      if (target) {
        this.dragging = target;
        this.dragStartPx = y;
        this.dragCurrentPx = y;
        e.preventDefault();
      }
    };

    const onMouseMove = (e: MouseEvent) => {
      if (!this.dragging) {
        // Update cursor on hover for horizontal ruler
        const hRect = this.hCanvas.getBoundingClientRect();
        const hx = e.clientX - hRect.left;
        const hy = e.clientY - hRect.top;
        if (hx >= 0 && hx <= hRect.width && hy >= 0 && hy <= hRect.height) {
          const target = this.getHitTarget(hx, hy, 'h');
          this.hCanvas.style.cursor = target
            ? (target.includes('margin') ? 'col-resize' : 'pointer')
            : 'default';
        }
        return;
      }
      // During drag, track position
      if (this.dragging === 'top-margin' || this.dragging === 'bottom-margin') {
        const rect = this.vCanvas.getBoundingClientRect();
        this.dragCurrentPx = e.clientY - rect.top;
      } else {
        const rect = this.hCanvas.getBoundingClientRect();
        this.dragCurrentPx = e.clientX - rect.left;
      }
      // Notify guideline callback
      if (
        this.dragging === 'left-margin' ||
        this.dragging === 'right-margin' ||
        this.dragging === 'text-indent' ||
        this.dragging === 'margin-left'
      ) {
        this.dragGuidelineCb?.({ x: this.dragCurrentPx });
      } else if (this.dragging === 'top-margin' || this.dragging === 'bottom-margin') {
        this.dragGuidelineCb?.({ y: this.dragCurrentPx });
      }
    };

    const onVMouseMove = (e: MouseEvent) => {
      if (this.dragging) return;
      const rect = this.vCanvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const target = this.getHitTarget(x, y, 'v');
      this.vCanvas.style.cursor = target ? 'row-resize' : 'default';
    };

    const onMouseUp = () => {
      if (!this.dragging) return;
      this.applyDrag();
      this.dragging = null;
      this.dragGuidelineCb?.(null);
    };

    this.bindEvent(this.hCanvas, 'mousedown', onHMouseDown as EventListener);
    this.bindEvent(this.vCanvas, 'mousedown', onVMouseDown as EventListener);
    this.bindEvent(this.vCanvas, 'mousemove', onVMouseMove as EventListener);
    this.bindEvent(document, 'mousemove', onMouseMove as EventListener);
    this.bindEvent(document, 'mouseup', onMouseUp as EventListener);
  }

  private bindEvent(target: EventTarget, event: string, handler: EventListener): void {
    target.addEventListener(event, handler);
    this.boundHandlers.push([target, event, handler]);
  }

  private applyDrag(): void {
    const delta = snapToGrid(this.dragCurrentPx - this.dragStartPx, this.grid.minorStepPx);
    if (Math.abs(delta) < 1) return;

    if (
      this.dragging === 'left-margin' ||
      this.dragging === 'right-margin' ||
      this.dragging === 'top-margin' ||
      this.dragging === 'bottom-margin'
    ) {
      const margins = { ...this.cachedMargins };
      switch (this.dragging) {
        case 'left-margin': margins.left += delta; break;
        case 'right-margin': margins.right -= delta; break;
        case 'top-margin': margins.top += delta; break;
        case 'bottom-margin': margins.bottom -= delta; break;
      }
      margins.left = Math.max(0, margins.left);
      margins.right = Math.max(0, margins.right);
      margins.top = Math.max(0, margins.top);
      margins.bottom = Math.max(0, margins.bottom);

      // Ensure content area remains positive
      const minContent = 20;
      if (margins.left + margins.right > this.cachedPageWidth - minContent) return;
      if (margins.top + margins.bottom > this.cachedPageHeight - minContent) return;

      this.marginChangeCb?.(margins);
    } else if (this.dragging === 'text-indent') {
      const newIndent = Math.max(0, (this.cachedBlockStyle?.textIndent ?? 0) + delta);
      this.indentChangeCb?.({ textIndent: snapToGrid(newIndent, this.grid.minorStepPx) });
    } else if (this.dragging === 'margin-left') {
      const newML = Math.max(0, (this.cachedBlockStyle?.marginLeft ?? 0) + delta);
      this.indentChangeCb?.({ marginLeft: snapToGrid(newML, this.grid.minorStepPx) });
    }
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
