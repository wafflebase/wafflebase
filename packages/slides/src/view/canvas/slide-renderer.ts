import type { Element } from '../../model/element';
import type { BackgroundImage, Slide, SlidesDocument } from '../../model/presentation';
import {
  SLIDE_WIDTH,
  deckSlideHeight,
  resolveBackgroundFill,
  resolveBackgroundImage,
} from '../../model/presentation';
import { buildElementWorldLookup } from '../../model/group';
import type { AnimState } from '../../anim/state';
import { drawElement } from './element-renderer';
import { drawImage, drawCropPreview, type CropPreview } from './image-renderer';
import { getActiveTheme, resolveFillStyle } from './render-context';

/** Global alpha applied to the hover-ghost element so the user can see
 * exactly what (kind + size + position) is about to be inserted while
 * still reading the slide content underneath. */
export const GHOST_ALPHA = 0.4;

export interface SlideRendererOptions {
  hostWidth: number;   // CSS pixels of the SLIDE rect (excludes pasteboard)
  hostHeight: number;  // CSS pixels of the SLIDE rect (excludes pasteboard)
  dpr: number;         // devicePixelRatio
  /**
   * Slide-logical pixels from the canvas top-left to the slide rect
   * top-left, on each axis. Non-zero values are how the editor turns
   * the empty area around the slide inside `canvasWrap` (the
   * "pasteboard") into a paint surface for off-slide elements.
   * The caller sizes the actual `<canvas>` bitmap big enough to
   * cover both the slide and the surrounding pasteboard; the
   * renderer translates the slide-logical origin to
   * `(slideOffsetLogicalX, slideOffsetLogicalY)` inside that bitmap
   * and paints the slide background + shadow only in the slide
   * rect, leaving the pasteboard transparent so `canvasWrap`'s CSS
   * background can supply the pasteboard color.
   *
   * Defaults `0` preserve pre-pasteboard behaviour (canvas == slide).
   */
  slideOffsetLogicalX?: number;
  slideOffsetLogicalY?: number;
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
    animStates?: ReadonlyMap<string, AnimState>,
    cropPreview?: CropPreview,
  ): void {
    this.dirty = true;
    drawSlide(
      this.ctx,
      slide,
      doc,
      this.options,
      () => this.markDirty(),
      ghosts,
      animStates,
      cropPreview,
    );
    this.dirty = false;
  }
}

/**
 * Functional core of the renderer — exposed for tests and for the
 * thumbnail path which doesn't need the dirty-flag bookkeeping. Looks
 * up the active theme from `doc`, fills the background through
 * `resolveFillStyle` (solid color or gradient), and dispatches each
 * element to `drawElement`.
 */
export function drawSlide(
  ctx: CanvasRenderingContext2D,
  slide: Slide,
  doc: SlidesDocument,
  options: SlideRendererOptions,
  onAssetLoad: () => void = () => undefined,
  ghosts?: readonly Element[],
  animStates?: ReadonlyMap<string, AnimState>,
  cropPreview?: CropPreview,
): void {
  const theme = getActiveTheme(doc);
  const slideH = deckSlideHeight(doc.meta);
  const { hostWidth, hostHeight, dpr } = options;
  const slideOffsetLogicalX = options.slideOffsetLogicalX ?? 0;
  const slideOffsetLogicalY = options.slideOffsetLogicalY ?? 0;
  const hasPasteboard = slideOffsetLogicalX !== 0 || slideOffsetLogicalY !== 0;
  // Uniform fit-scale: pick whichever axis is the binding constraint
  // so the slide fits inside the host canvas without distortion. The
  // SlidesView host is currently a fixed 16:9 (960×540), so both
  // axes give the same scale — but a host whose aspect ratio differs
  // from SLIDE_WIDTH:SLIDE_HEIGHT would have the slide stretched
  // horizontally if we derived the scale from `hostWidth` alone.
  const scaleX = (hostWidth / SLIDE_WIDTH) * dpr;
  const scaleY = (hostHeight / slideH) * dpr;
  const scale = Math.min(scaleX, scaleY);

  // Reset to identity and clear the full bitmap. With pasteboard the
  // off-slide band stays transparent so `canvasWrap`'s CSS background
  // can supply the pasteboard color. Without pasteboard (default) we
  // still fill the full bitmap with the slide background fill — this
  // hides the 1–2 px aspect-ratio rounding gap that would otherwise
  // reveal the canvas's CSS `background` underneath. With pasteboard
  // the slide-bg fill below pads its own slide rect by ±1 logical
  // px for the same reason.
  //
  // Bitmap dims come from `ctx.canvas` when available (the real
  // browser canvas, which the caller has sized to cover slide +
  // pasteboard). The test 2D-context stub doesn't expose `canvas`,
  // so fall back to `hostWidth × hostHeight` — tests don't drive a
  // non-zero pasteboard, so the fallback matches reality there.
  const bitmapW = ctx.canvas?.width ?? hostWidth * dpr;
  const bitmapH = ctx.canvas?.height ?? hostHeight * dpr;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  if (!hasPasteboard) {
    // This branch runs under the IDENTITY ctm (the `ctx.scale(scale,
    // scale)` below hasn't been applied yet) and fills the DEVICE-pixel
    // rect `fillRect(0, 0, bitmapW, bitmapH)`. A gradient's axis must
    // therefore be laid out across `bitmapW × bitmapH`, not the logical
    // `SLIDE_WIDTH × slideH` — otherwise the axis only matches the
    // filled rect when `bitmapW === SLIDE_WIDTH` (e.g. it silently
    // breaks thumbnails, PDF export, and no-pasteboard presentation /
    // mobile, whose bitmaps are smaller than the logical slide).
    ctx.fillStyle = resolveFillStyle(
      ctx, resolveBackgroundFill(slide, doc), theme, bitmapW, bitmapH,
    );
    ctx.fillRect(0, 0, bitmapW, bitmapH);
  } else {
    ctx.clearRect(0, 0, bitmapW, bitmapH);
  }
  ctx.scale(scale, scale);
  if (hasPasteboard) {
    // Move slide-logical (0,0) to the slide rect inside the bigger
    // canvas so every drawElement call paints relative to
    // slide-left/top without per-element offset bookkeeping.
    // Coordinates outside the slide rect (negative x/y, or beyond
    // SLIDE_WIDTH / SLIDE_HEIGHT) now land in the pasteboard band
    // rather than off the bitmap.
    ctx.translate(slideOffsetLogicalX, slideOffsetLogicalY);
    // Slide background fill, restricted to the slide rect. The ±1 px
    // pad absorbs the same aspect-ratio rounding gap the
    // no-pasteboard path solves with a full-canvas fill. Drop shadow
    // and hairline are owned by `slideElevation` in slides-view.tsx
    // — keeping them in CSS means they survive every paint mode
    // (no-pasteboard, mobile, presenter, …) and stay theme-reactive.
    ctx.fillStyle = resolveFillStyle(
      ctx, resolveBackgroundFill(slide, doc), theme, SLIDE_WIDTH, slideH,
    );
    ctx.fillRect(-1, -1, SLIDE_WIDTH + 2, slideH + 2);
  }

  // Image-fill background (PPTX `<p:bg><p:bgPr><a:blipFill>`). Painted
  // *after* the full-canvas color fill so the surrounding strip stays
  // background-color and transparent regions of the image still show
  // the color underneath. Stretch to the logical 1920×1080 region
  // because that's what OOXML `<a:stretch><a:fillRect/></a:stretch>`
  // means; tile mode is a v3 problem.
  const bgImage = pickBackgroundImage(slide, doc);
  if (bgImage) {
    drawImage(ctx, { w: SLIDE_WIDTH, h: slideH }, bgImage, onAssetLoad);
  }

  // Iterate elements in array order = z-order, last is front. Built
  // once per slide-render so each connector doesn't rebuild it.
  const elementsLookup = buildElementWorldLookup(slide.elements);
  for (const element of slide.elements) {
    // The element under an active crop session is painted by the crop
    // preview below (dimmed full bitmap + bright window), not as a
    // normal cropped element, so mask it here.
    if (cropPreview && element.id === cropPreview.elementId) continue;
    drawElement(
      ctx, element, doc, theme, onAssetLoad, elementsLookup,
      undefined, undefined, animStates?.get(element.id),
    );
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

  // Crop session preview on top: dimmed full bitmap + bright crop
  // window. Drawn last so the dimmed band reads clearly over slide
  // content and the bright window is never occluded by other elements.
  if (cropPreview) {
    drawCropPreview(ctx, cropPreview, onAssetLoad);
  }
}

/**
 * Image background precedence slide → layout → master (see
 * {@link resolveBackgroundImage}). Returns `undefined` when none is set.
 */
function pickBackgroundImage(
  slide: Slide,
  doc: SlidesDocument,
): BackgroundImage | undefined {
  return resolveBackgroundImage(slide, doc);
}
