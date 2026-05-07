import type { Slide } from '../../model/presentation';
import { SlideRenderer, type SlideRendererOptions } from './slide-renderer';

/**
 * Render a slide thumbnail onto the given ctx. Internally constructs
 * a SlideRenderer with the supplied host size and forces a single
 * paint. Thumbnails always render — there is no dirty tracking at
 * this layer because the caller (the editor) has already decided that
 * a thumbnail needs refreshing.
 */
export function renderThumbnail(
  ctx: CanvasRenderingContext2D,
  slide: Slide,
  options: SlideRendererOptions,
): void {
  const renderer = new SlideRenderer(ctx, options);
  renderer.render(slide);
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
