import type { Element } from '../../model/element';
import type { BackgroundImage, Slide, SlidesDocument } from '../../model/presentation';
import { SLIDE_HEIGHT, SLIDE_WIDTH } from '../../model/presentation';
import { flattenElements } from '../../model/group';
import { resolveColor } from '../../model/theme';
import { drawElement } from './element-renderer';
import { drawImage } from './image-renderer';
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
   * `ghosts` — optional elements drawn on top of the committed slide at
   * `GHOST_ALPHA`. Used by three live-paint paths:
   *   - shape-insert hover preview (single ghost of the to-be-inserted
   *     shape under the cursor before mousedown).
   *   - connector endpoint drag preview (single ghost copy of the
   *     connector with the dragged endpoint moved to the cursor target,
   *     while the real connector stays anchored on `slide`).
   *   - shape-move drag preview (one ghost per selected element at the
   *     dragged offset).
   * Kept out of `slide` so the ghost never participates in selection,
   * hit-test, or z-order. For a connector ghost, attached endpoints
   * still resolve through `slide`'s element lookup, so a half-attached
   * ghost line stays visually anchored to its host shape.
   */
  forceRender(
    slide: Slide,
    doc: SlidesDocument,
    ghosts?: readonly Element[],
  ): void {
    this.dirty = true;
    drawSlide(this.ctx, slide, doc, this.options, () => this.markDirty(), ghosts);
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
  ghosts?: readonly Element[],
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

  // Image-fill background (PPTX `<p:bg><p:bgPr><a:blipFill>`). Painted
  // *after* the full-canvas color fill so the surrounding strip stays
  // background-color and transparent regions of the image still show
  // the color underneath. Stretch to the logical 1920×1080 region
  // because that's what OOXML `<a:stretch><a:fillRect/></a:stretch>`
  // means; tile mode is a v3 problem.
  const bgImage = pickBackgroundImage(slide, doc);
  if (bgImage) {
    drawImage(ctx, { w: SLIDE_WIDTH, h: SLIDE_HEIGHT }, bgImage, onAssetLoad);
  }

  // Iterate elements in array order = z-order, last is front.
  // Element lookup is consumed by the connector renderer to resolve
  // attached endpoints. Built once per slide-render so each connector
  // doesn't rebuild it.
  // flattenElements walks the tree DFS so elements nested inside groups
  // are included — a connector whose endpoint targets a shape inside a
  // group can still resolve the attachment point correctly.
  const elementsLookup = new Map<string, Element>(
    flattenElements(slide.elements).map((e) => [e.id, e] as const),
  );
  for (const element of slide.elements) {
    drawElement(ctx, element, doc, theme, onAssetLoad, elementsLookup);
  }

  if (ghosts !== undefined && ghosts.length > 0) {
    // Paint hover/drag-preview ghosts on top of the committed slide so
    // their semi-transparency reveals the underlying content. One
    // save/restore band per ghost keeps `globalAlpha` writes scoped
    // and isolates any future per-ghost style overrides.
    for (const ghost of ghosts) {
      ctx.save();
      ctx.globalAlpha = GHOST_ALPHA;
      drawElement(ctx, ghost, doc, theme, onAssetLoad, elementsLookup);
      ctx.restore();
    }
  }
}

/**
 * Slide-level image background takes precedence; otherwise inherit
 * from the deck's master so master-only image decks still render.
 * Returns `undefined` when neither is set.
 */
function pickBackgroundImage(
  slide: Slide,
  doc: SlidesDocument,
): BackgroundImage | undefined {
  if (slide.background.image) return slide.background.image;
  const master = doc.masters.find((m) => m.id === doc.meta.masterId);
  return master?.background.image;
}
