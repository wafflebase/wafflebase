/**
 * SlidesRuler — horizontal + vertical rulers for the slides editor.
 *
 * Reuses the docs ruler's tick / unit primitives via the shared
 * exports on `@wafflebase/docs`, with a slides-specific 144 dpi
 * physical scale (1920 logical px / 13.333"). Display-only in v1:
 * paint ticks + integer-unit labels (inch / cm, locale-driven) along
 * the slide canvas extent. Guides and drag-out gestures land in a
 * later phase.
 *
 * The slides canvas has no scroll in v1 (the deck zoom-to-fits the
 * available column width via `editor.setHostSize`), so the ruler
 * derives its scale entirely from the host dimensions: one slide
 * logical pixel maps to `hostWidth / SLIDE_WIDTH` host pixels, which
 * the renderer pre-multiplies into the grid step sizes before
 * handing them to `drawTicks`.
 */

import {
  detectUnit,
  getGridConfig,
  drawTicks,
  type RulerUnit,
  type GridConfig,
  type TickDensity,
} from '@wafflebase/docs';

import { SLIDE_WIDTH } from '../../../model/presentation';

/**
 * Ruler thickness in CSS pixels.
 *
 * Intentionally slimmer than the docs ruler (20 px). The slide is a
 * "stage" rather than a "page" — a heavy ruler bar clutters the
 * canvas chrome and competes with the slide elevation. 14 px keeps
 * the tick + integer-unit label readable while reclaiming ~30 % of
 * the gutter the docs ruler reserves.
 */
export const RULER_SIZE = 14;

/**
 * Pixel-per-inch in the slides logical coordinate system.
 *
 * Slides ship a 1920 × 1080 logical canvas that maps to a 13.333" ×
 * 7.5" PDF page (matches PowerPoint's 16:9 default). 1920 / 13.333 ≈
 * 144, so one slide logical pixel ≈ 1/144 inch. Compare with the docs
 * ruler, where logical px are 1/96 inch (CSS pixels).
 */
export const SLIDES_PX_PER_INCH = 144;

// Tick + label proportions tuned to the slim 14-px ruler. Major ticks
// occupy ~40 % of the ruler height so an 8-px label can sit at the
// top edge (y = 0) without colliding with the tick stem at the
// bottom.
const TICK_HEIGHTS = { major: 6, half: 4, minor: 2 };
const LABEL_FONT = '8px Arial';
const LABEL_INSET = 0;
const VERTICAL_LABEL_INSET = 4;
// Soft neutral so the ruler reads as chrome, not a measurement bar.
// Inherits from the surrounding column instead of painting its own
// background — keeps the visual weight on the slide itself.
const TICK_COLOR = '#b0b0b0';

export interface SlidesRulerOptions {
  hCanvas: HTMLCanvasElement;
  vCanvas: HTMLCanvasElement;
  corner: HTMLElement;
  /** Override the device-pixel-ratio (mainly for tests). */
  dpr?: number;
  /** Override locale-driven unit detection. */
  unit?: RulerUnit;
}

export interface SlidesRulerViewport {
  /** Slide-canvas width in CSS pixels (excluding the 20 px ruler gutter). */
  hostWidth: number;
  /** Slide-canvas height in CSS pixels. */
  hostHeight: number;
  /**
   * Slide-logical pixels currently visible in the host. Reserved for a
   * future pannable / scrolled mode; pass 0 in v1.
   */
  scrollX?: number;
  scrollY?: number;
}

export class SlidesRuler {
  private readonly hCanvas: HTMLCanvasElement;
  private readonly vCanvas: HTMLCanvasElement;
  private readonly corner: HTMLElement;
  private readonly hCtx: CanvasRenderingContext2D | null;
  private readonly vCtx: CanvasRenderingContext2D | null;
  private readonly dpr: number;
  private unit: RulerUnit;
  private grid: GridConfig;
  private disposed = false;

  constructor(opts: SlidesRulerOptions) {
    this.hCanvas = opts.hCanvas;
    this.vCanvas = opts.vCanvas;
    this.corner = opts.corner;
    this.hCtx = opts.hCanvas.getContext('2d');
    this.vCtx = opts.vCanvas.getContext('2d');
    this.dpr =
      opts.dpr ??
      (typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1);
    const detected =
      opts.unit ??
      detectUnit(typeof navigator !== 'undefined' ? navigator.language : undefined);
    this.unit = detected;
    this.grid = getGridConfig(detected, SLIDES_PX_PER_INCH);
    // Transparent corner — inherits the surrounding column color so
    // the slim ruler reads as soft chrome, not a framed bar.
    this.corner.style.background = 'transparent';
  }

  setUnit(unit: RulerUnit): void {
    if (this.unit === unit) return;
    this.unit = unit;
    this.grid = getGridConfig(unit, SLIDES_PX_PER_INCH);
  }

  getUnit(): RulerUnit {
    return this.unit;
  }

  render(viewport: SlidesRulerViewport): void {
    if (this.disposed) return;
    const { hostWidth, hostHeight } = viewport;
    if (hostWidth <= 0 || hostHeight <= 0) return;

    const zoom = hostWidth / SLIDE_WIDTH;
    const scaledGrid: GridConfig = {
      subdivisions: this.grid.subdivisions,
      majorStepPx: this.grid.majorStepPx * zoom,
      minorStepPx: this.grid.minorStepPx * zoom,
    };
    const density = pickDensity(scaledGrid.majorStepPx);

    this.paintHorizontal(hostWidth, scaledGrid, density);
    this.paintVertical(hostHeight, scaledGrid, density);
  }

  /**
   * Test seam: returns the density band that would be used for the
   * given zoom factor (host width / SLIDE_WIDTH). The renderer derives
   * its band from the same calculation, so tests can pin transitions
   * without spying on the canvas context.
   */
  densityFor(zoom: number): TickDensity {
    return pickDensity(this.grid.majorStepPx * zoom);
  }

  dispose(): void {
    this.disposed = true;
  }

  private paintHorizontal(
    hostWidth: number,
    grid: GridConfig,
    density: TickDensity,
  ): void {
    const ctx = this.hCtx;
    if (!ctx) return;
    this.resizeCanvas(this.hCanvas, hostWidth, RULER_SIZE);
    // Transparent ruler: clear instead of painting a background fill
    // so the canvas wrapper's color shows through. Keeps the slide
    // edge + drop shadow as the strongest visual anchor in the
    // canvas area.
    ctx.clearRect(0, 0, hostWidth, RULER_SIZE);
    drawTicks({
      ctx,
      axis: 'h',
      start: 0,
      length: hostWidth,
      grid,
      color: TICK_COLOR,
      density,
      rulerSize: RULER_SIZE,
      tickHeights: TICK_HEIGHTS,
      labelFont: LABEL_FONT,
      labelInset: LABEL_INSET,
      verticalLabelInset: VERTICAL_LABEL_INSET,
    });
  }

  private paintVertical(
    hostHeight: number,
    grid: GridConfig,
    density: TickDensity,
  ): void {
    const ctx = this.vCtx;
    if (!ctx) return;
    this.resizeCanvas(this.vCanvas, RULER_SIZE, hostHeight);
    ctx.clearRect(0, 0, RULER_SIZE, hostHeight);
    drawTicks({
      ctx,
      axis: 'v',
      start: 0,
      length: hostHeight,
      grid,
      color: TICK_COLOR,
      density,
      rulerSize: RULER_SIZE,
      tickHeights: TICK_HEIGHTS,
      labelFont: LABEL_FONT,
      labelInset: LABEL_INSET,
      verticalLabelInset: VERTICAL_LABEL_INSET,
    });
  }

  private resizeCanvas(
    canvas: HTMLCanvasElement,
    width: number,
    height: number,
  ): void {
    const backingW = Math.max(1, Math.round(width * this.dpr));
    const backingH = Math.max(1, Math.round(height * this.dpr));
    if (canvas.width !== backingW || canvas.height !== backingH) {
      canvas.width = backingW;
      canvas.height = backingH;
      const ctx = canvas.getContext('2d');
      // Reset transform first — Canvas spec preserves the active
      // transform across width/height assignments only in some
      // browsers, and ctx.scale composes on top of the existing
      // matrix. setTransform(1,0,0,1,0,0) zeroes the matrix; the
      // subsequent scale(dpr,dpr) then produces 1 CSS px = 1 logical
      // unit regardless of prior frames.
      ctx?.setTransform(1, 0, 0, 1, 0, 0);
      ctx?.scale(this.dpr, this.dpr);
    }
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
  }
}

function pickDensity(majorStepOnScreen: number): TickDensity {
  if (majorStepOnScreen >= 60) return 'full';
  if (majorStepOnScreen >= 30) return 'half-only';
  if (majorStepOnScreen >= 15) return 'major';
  return 'major-thinned';
}
