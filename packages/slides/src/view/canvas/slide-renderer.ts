import type { Slide, SlidesDocument } from '../../model/presentation';
import { SLIDE_HEIGHT, SLIDE_WIDTH } from '../../model/presentation';
import { resolveColor } from '../../model/theme';
import { drawElement } from './element-renderer';
import { getActiveTheme } from './render-context';

export interface SlideRendererOptions {
  hostWidth: number;   // CSS pixels of the target <canvas>
  hostHeight: number;  // CSS pixels of the target <canvas>
  dpr: number;         // devicePixelRatio
}

/**
 * Renders a single `Slide` onto a Canvas 2D context. Owns the
 * world↔host coordinate scale (logical 1920×1080 → host pixels) and
 * a dirty flag so consumers can call `render()` on every animation
 * frame without re-painting unchanged slides.
 *
 * One renderer per visible slide. Sharing a single renderer across
 * multiple slides is an anti-pattern — the dirty flag is per-slide
 * state.
 */
export class SlideRenderer {
  private dirty = true;
  // Explicit field declarations + body assignments instead of TypeScript
  // parameter properties. Node's `--experimental-strip-types` (used by
  // the frontend test runner) cannot parse parameter properties, so any
  // file that flows through `@wafflebase/slides`'s public surface must
  // stay strip-types compatible — otherwise the SLIDES_SRC_INDEX
  // fallback in `frontend/tests/resolve-hooks.mjs` blows up when the
  // dist isn't pre-built.
  private ctx: CanvasRenderingContext2D;
  private options: SlideRendererOptions;

  constructor(
    ctx: CanvasRenderingContext2D,
    options: SlideRendererOptions,
  ) {
    this.ctx = ctx;
    this.options = options;
  }

  /** Trigger a repaint on the next `render()` call. */
  markDirty(): void {
    this.dirty = true;
  }

  /**
   * Paint `slide` onto the bound ctx if dirty. No-op otherwise.
   *
   * `doc` provides the active theme via `getActiveTheme(doc)`; every
   * `ctx.fillStyle` / `ctx.strokeStyle` downstream is resolved against
   * that theme so the same canvas pipeline serves both srgb (literal)
   * and role-bound (palette) colors.
   */
  render(slide: Slide, doc: SlidesDocument): void {
    if (!this.dirty) return;
    drawSlide(this.ctx, slide, doc, this.options, () => this.markDirty());
    this.dirty = false;
  }

  /**
   * Paint unconditionally (bypass the dirty check). Used by interaction
   * live-paint paths in the editor that need to draw an in-memory
   * frame override on every mousemove without committing to the store.
   */
  forceRender(slide: Slide, doc: SlidesDocument): void {
    this.dirty = true;
    this.render(slide, doc);
  }
}

/**
 * Functional core of the renderer — exposed for tests and for the
 * thumbnail path which doesn't need the dirty-flag bookkeeping. Looks
 * up the active theme from `doc`, fills the background through
 * `resolveColor`, and dispatches each element to `drawElement`.
 */
export function drawSlide(
  ctx: CanvasRenderingContext2D,
  slide: Slide,
  doc: SlidesDocument,
  options: SlideRendererOptions,
  onAssetLoad: () => void = () => undefined,
): void {
  const theme = getActiveTheme(doc);
  const { hostWidth, hostHeight, dpr } = options;
  // Uniform fit-scale: pick whichever axis is the binding constraint
  // so the slide fits inside the host canvas without distortion. The
  // SlidesView host is currently a fixed 16:9 (960×540), so both
  // axes give the same scale — but a host whose aspect ratio differs
  // from SLIDE_WIDTH:SLIDE_HEIGHT would have the slide stretched
  // horizontally if we derived the scale from `hostWidth` alone.
  const scaleX = (hostWidth / SLIDE_WIDTH) * dpr;
  const scaleY = (hostHeight / SLIDE_HEIGHT) * dpr;
  const scale = Math.min(scaleX, scaleY);

  // Reset to identity, clear, then re-establish the world scale so
  // the content paints at the correct host pixel size regardless of
  // any leftover transforms from a previous render.
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, hostWidth * dpr, hostHeight * dpr);
  ctx.scale(scale, scale);

  // Background fill — image-fill backgrounds are v2.
  ctx.fillStyle = resolveColor(slide.background.fill, theme);
  ctx.fillRect(0, 0, SLIDE_WIDTH, SLIDE_HEIGHT);

  // Iterate elements in array order = z-order, last is front.
  for (const element of slide.elements) {
    drawElement(ctx, element, doc, theme, onAssetLoad);
  }
}
