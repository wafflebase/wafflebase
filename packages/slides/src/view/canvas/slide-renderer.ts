import type { Element } from '../../model/element';
import type { Slide, SlidesDocument } from '../../model/presentation';
import { SLIDE_HEIGHT, SLIDE_WIDTH } from '../../model/presentation';
import { resolveColor } from '../../model/theme';
import { drawElement } from './element-renderer';
import { getActiveTheme } from './render-context';

/** Global alpha applied to the hover-ghost element so the user can see
 * exactly what (kind + size + position) is about to be inserted while
 * still reading the slide content underneath. */
export const GHOST_ALPHA = 0.4;

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
   *
   * `ghost` — optional element drawn on top of the committed slide at
   * `GHOST_ALPHA` so the hover-preview semi-transparently shows the
   * shape that *would* be inserted on click. Kept out of `slide` so
   * the ghost never participates in selection, hit-test, or z-order.
   */
  forceRender(slide: Slide, doc: SlidesDocument, ghost?: Element): void {
    this.dirty = true;
    drawSlide(this.ctx, slide, doc, this.options, () => this.markDirty(), ghost);
    this.dirty = false;
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
  ghost?: Element,
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

  // Reset to identity, paint the slide background across the FULL canvas
  // (not just the logical 1920×1080 region), then re-establish the world
  // scale so element content paints at the correct host pixel size.
  //
  // Filling the full canvas — rather than `fillRect(0, 0, SLIDE_W, SLIDE_H)`
  // after the scale transform — hides 1–2 px aspect-ratio rounding gaps on
  // the right/bottom edges. Without this, host dimensions whose ratio drifts
  // from SLIDE_WIDTH:SLIDE_HEIGHT (rounding from `computeFitSize` →
  // `Math.round`) leave a transparent strip that reveals the canvas's CSS
  // `background` underneath. That strip reads white in light mode and reads
  // as a flashing white edge in dark mode + Simple Dark, where the slide
  // background is `#202124` but the canvas backdrop stays `#fff`.
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = resolveColor(slide.background.fill, theme);
  ctx.fillRect(0, 0, hostWidth * dpr, hostHeight * dpr);
  ctx.scale(scale, scale);

  // Iterate elements in array order = z-order, last is front. Image-fill
  // backgrounds are v2 — when they land, paint the image inside the
  // logical 1920×1080 region *after* this full-canvas color fill so the
  // image still represents the slide and the surrounding strip stays
  // background-color.
  for (const element of slide.elements) {
    drawElement(ctx, element, doc, theme, onAssetLoad);
  }

  if (ghost !== undefined) {
    // Paint the hover-preview ghost on top of the committed slide so
    // its semi-transparency reveals the underlying content. Using
    // `globalAlpha` rather than per-shape opacity means every kind
    // (filled basic, outlined callout, two-tone action button) ends
    // up at the same readable opacity without per-renderer tweaks.
    ctx.save();
    ctx.globalAlpha = GHOST_ALPHA;
    drawElement(ctx, ghost, doc, theme, onAssetLoad);
    ctx.restore();
  }
}
