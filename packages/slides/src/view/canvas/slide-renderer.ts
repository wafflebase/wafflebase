import type { Slide } from '../../model/presentation';
import { SLIDE_HEIGHT, SLIDE_WIDTH } from '../../model/presentation';
import { drawElement } from './element-renderer';

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

  constructor(
    private ctx: CanvasRenderingContext2D,
    private options: SlideRendererOptions,
  ) {}

  /** Trigger a repaint on the next `render()` call. */
  markDirty(): void {
    this.dirty = true;
  }

  /**
   * Paint `slide` onto the bound ctx if dirty. No-op otherwise.
   */
  render(slide: Slide): void {
    if (!this.dirty) return;
    const { ctx } = this;
    const { hostWidth, hostHeight, dpr } = this.options;
    const scale = (hostWidth / SLIDE_WIDTH) * dpr;

    // Reset to identity, clear, then re-establish the world scale so
    // the content paints at the correct host pixel size regardless of
    // any leftover transforms from a previous render.
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, hostWidth * dpr, hostHeight * dpr);
    ctx.scale(scale, scale);

    // Background fill — image-fill backgrounds are v2.
    ctx.fillStyle = slide.background.fill;
    ctx.fillRect(0, 0, SLIDE_WIDTH, SLIDE_HEIGHT);

    // Iterate elements in array order = z-order, last is front.
    for (const element of slide.elements) {
      drawElement(ctx, element, () => this.markDirty());
    }

    this.dirty = false;
  }

  /**
   * Paint unconditionally (bypass the dirty check). Used by interaction
   * live-paint paths in the editor that need to draw an in-memory
   * frame override on every mousemove without committing to the store.
   */
  forceRender(slide: Slide): void {
    this.dirty = true;
    this.render(slide);
  }
}
