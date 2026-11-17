/**
 * SlidesRuler — horizontal + vertical rulers for the slides editor.
 *
 * Reuses the docs ruler's tick / unit primitives via the shared
 * exports on `@wafflebase/docs`, with a slides-specific 144 dpi
 * physical scale (1920 logical px / 13.333"). Paints ticks +
 * integer-unit labels (inch / cm) along the slide canvas extent. The
 * editor drives the unit from the deck's `meta.unit` so the ruler and
 * the Format options panel always agree; locale detection is only the
 * default for a ruler constructed without one.
 *
 * Layout contract: the host positions both ruler canvases as
 * absolutely-placed frames around the canvas area (top edge / left
 * edge), NOT around the slide itself. The slide can drift inside the
 * frame as the column resizes or the speaker-notes panel is dragged;
 * the ruler stays pinned to the frame and projects its tick "zero"
 * onto wherever the slide's left / top edge currently lives. The
 * renderer reads each ruler canvas's own `clientWidth` /
 * `clientHeight` to know its painted extent and derives the slide
 * offset from `(frame - host) / 2` (the canvas-area's flex centering
 * is the source of truth for that).
 */

import {
  Theme,
  detectUnit,
  getGridConfig,
  drawTicks,
  type RulerUnit,
  type GridConfig,
  type TickDensity,
} from '@wafflebase/docs';

import { SLIDE_WIDTH, type Meta } from '../../../model/presentation';

/**
 * Ruler thickness in CSS pixels.
 *
 * Intentionally slimmer than the docs ruler (20 px). The slide is a
 * "stage" rather than a "page" — a heavy ruler bar clutters the
 * canvas chrome and competes with the slide elevation. 14 px still
 * fits a 10-px label (the DESIGN.md floor) above a 5-px major tick
 * while reclaiming ~30 % of the gutter the docs ruler reserves.
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

// Tick + label proportions tuned to the slim 14-px ruler. A 10-px
// Arial digit is ~7 px of ink below ~2 px of ascent slack, so lifting
// the label 1 px (inset -1) puts its ink at y ≈ 1..8 and the 5-px
// major tick at y = 9..14 — the two never touch.
const TICK_HEIGHTS = { major: 5, half: 3, minor: 2 };
const LABEL_FONT = '10px Arial';
const LABEL_INSET = -1;
const VERTICAL_LABEL_INSET = 4;

export interface SlidesRulerOptions {
  hCanvas: HTMLCanvasElement;
  vCanvas: HTMLCanvasElement;
  corner: HTMLElement;
  /** Override the device-pixel-ratio (mainly for tests). */
  dpr?: number;
  /** Initial unit; locale-detected when omitted. */
  unit?: RulerUnit;
}

export interface SlidesRulerViewport {
  /** Slide-canvas width in CSS pixels (excluding the 14-px ruler gutter). */
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
    const scrollX = viewport.scrollX ?? 0;
    const scrollY = viewport.scrollY ?? 0;
    if (hostWidth <= 0 || hostHeight <= 0) return;

    const zoom = hostWidth / SLIDE_WIDTH;
    const scaledGrid: GridConfig = {
      subdivisions: this.grid.subdivisions,
      majorStepPx: this.grid.majorStepPx * zoom,
      minorStepPx: this.grid.minorStepPx * zoom,
    };
    const density = pickDensity(scaledGrid.majorStepPx);
    const color = this.tickColor();

    this.paintHorizontal(hostWidth, scaledGrid, density, scrollX, color);
    this.paintVertical(hostHeight, scaledGrid, density, scrollY, color);
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

  /**
   * Tick + label color, resolved per paint from the CSS `color` the
   * host cascades onto the ruler canvas (slides-view gives it the
   * `text-muted-foreground` token). Canvas cannot read `currentColor`
   * itself, and resolving every paint means a light/dark switch lands
   * on the next RAF frame with no theme subscription. The docs ruler
   * token is the fallback where no style is computed.
   */
  private tickColor(): string {
    if (typeof getComputedStyle === 'function') {
      const color = getComputedStyle(this.hCanvas).color;
      if (color) return color;
    }
    return Theme.rulerTickColor;
  }

  private paintHorizontal(
    hostWidth: number,
    grid: GridConfig,
    density: TickDensity,
    scrollX: number,
    color: string,
  ): void {
    const ctx = this.hCtx;
    if (!ctx) return;
    // The host pins the H ruler with `left: RULER_SIZE; right: 0`, so
    // its painted width is whatever the column gives it. Match the
    // backing store to that laid-out CSS width (fall back to host width
    // in environments where layout hasn't run, e.g. jsdom).
    const frameWidth = this.hCanvas.clientWidth || hostWidth;
    this.resizeCanvas(this.hCanvas, frameWidth, RULER_SIZE);
    ctx.clearRect(0, 0, frameWidth, RULER_SIZE);
    // The slide's left edge sits at:
    //   - the midpoint of the slack when the slide fits inside the
    //     scroll host (centered, scrollX = 0), or
    //   - the scroll content's origin (0) when it overflows, then
    //     shifted left by `scrollX` to track the viewport.
    // Negative results are legitimate: they mean the slide's 0 tick has
    // scrolled off-screen to the left. `drawTicks` clips ticks that
    // fall outside `[0, frameWidth]` naturally.
    const slack = frameWidth - hostWidth;
    const slideContentOffset = slack > 0 ? slack / 2 : 0;
    const slideOffset = slideContentOffset - scrollX;
    drawTicks({
      ctx,
      axis: 'h',
      start: slideOffset,
      length: hostWidth,
      grid,
      color,
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
    scrollY: number,
    color: string,
  ): void {
    const ctx = this.vCtx;
    if (!ctx) return;
    const frameHeight = this.vCanvas.clientHeight || hostHeight;
    this.resizeCanvas(this.vCanvas, RULER_SIZE, frameHeight);
    ctx.clearRect(0, 0, RULER_SIZE, frameHeight);
    const slack = frameHeight - hostHeight;
    const slideContentOffset = slack > 0 ? slack / 2 : 0;
    const slideOffset = slideContentOffset - scrollY;
    drawTicks({
      ctx,
      axis: 'v',
      start: slideOffset,
      length: hostHeight,
      grid,
      color,
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
    // CSS dimensions intentionally NOT set here — the host owns the
    // absolute positioning (top / left / right / bottom on the ruler
    // canvases). Setting them would override the host's "right: 0"
    // pin and shrink the ruler back to host width.
  }
}

/**
 * The ruler unit for a deck. Mirrors the Format options panel's
 * `meta.unit ?? 'in'` (and the `Meta.unit` contract, "absent ⇒ 'in'")
 * rather than the viewer's locale, so the two surfaces never disagree.
 */
export function rulerUnitOf(meta: Pick<Meta, 'unit'>): RulerUnit {
  return meta.unit === 'cm' ? 'cm' : 'inch';
}

function pickDensity(majorStepOnScreen: number): TickDensity {
  if (majorStepOnScreen >= 60) return 'full';
  if (majorStepOnScreen >= 30) return 'half-only';
  if (majorStepOnScreen >= 15) return 'major';
  return 'major-thinned';
}
