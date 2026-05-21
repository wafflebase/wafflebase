import type { Slide, SlidesDocument } from '../../model/presentation';
import { drawSlide, type SlideRendererOptions } from './slide-renderer';

/**
 * Render a slide thumbnail onto the given ctx. Calls `drawSlide`
 * directly — no SlideRenderer wrapper, because the renderer's
 * dirty-flag is per-instance state and a one-shot thumbnail paint
 * discards the instance immediately after.
 *
 * `doc` provides the active theme — every theme-bound color in the
 * thumbnail (background, shapes) resolves through it, exactly the way
 * the main slide canvas does.
 *
 * `onAssetLoad` is invoked when an image referenced by the slide
 * (background image, image element, master image) finishes loading
 * asynchronously. Without this callback, a thumbnail painted while
 * its image is still loading would never refresh — the SlideRenderer
 * that drawSlide normally hands its `markDirty` to has already been
 * GC'd. The thumbnail panel uses this to coalesce per-slide repaints
 * via `ThumbnailScheduler`.
 */
export function renderThumbnail(
  ctx: CanvasRenderingContext2D,
  slide: Slide,
  doc: SlidesDocument,
  options: SlideRendererOptions,
  onAssetLoad?: () => void,
): void {
  drawSlide(ctx, slide, doc, options, onAssetLoad);
}

/**
 * Coalesces multiple `schedule(slideId)` calls into a single
 * `onFlush(ids)` invocation after `debounceMs` of quiet time. Used by
 * the editor to batch thumbnail re-renders during rapid edits.
 */
export class ThumbnailScheduler {
  private pending = new Set<string>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  // Explicit declarations + body assignments so this file stays
  // parseable by Node's `--experimental-strip-types`.
  private debounceMs: number;
  private onFlush: (slideIds: string[]) => void;

  constructor(
    debounceMs: number,
    onFlush: (slideIds: string[]) => void,
  ) {
    this.debounceMs = debounceMs;
    this.onFlush = onFlush;
  }

  schedule(slideId: string): void {
    this.pending.add(slideId);
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), this.debounceMs);
  }

  /** Force a flush right now (e.g. on editor blur). */
  flushNow(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.flush();
  }

  /**
   * Drop the pending batch without invoking `onFlush`. The right call
   * on panel dispose so a timer that started ~99ms before tear-down
   * doesn't fire ~1ms after into a cleared state map. `flushNow()`
   * would also work today because the panel's onFlush bails on its
   * `disposed` flag, but `cancel()` makes the lifecycle explicit
   * instead of relying on that guard.
   */
  cancel(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.pending.clear();
  }

  private flush(): void {
    if (this.pending.size === 0) {
      this.timer = null;
      return;
    }
    const ids = Array.from(this.pending);
    this.pending.clear();
    this.timer = null;
    this.onFlush(ids);
  }
}
