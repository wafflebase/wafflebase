/**
 * Per-process cache of loaded `HTMLImageElement`s, keyed by `src`.
 * Mirrors `packages/docs/src/view/image-cache.ts` so the two packages
 * behave the same way; we copy rather than import because docs does
 * not export this helper from its public API.
 */
const imageCache = new Map<string, HTMLImageElement>();
const pendingCallbacks = new Map<string, Set<() => void>>();
// URLs whose `<img>` load fired `onerror`. Tracked separately from the
// cache so the renderer can distinguish "still loading" (return null,
// repaint when load completes) from "failed permanently" (paint a
// placeholder so the user sees the alt text and isn't staring at a
// blank rectangle forever).
const failedImages = new Set<string>();

/**
 * Return a loaded `HTMLImageElement` for `src`, or `null` if it is
 * still loading OR has failed. Use `isImageFailed(src)` to distinguish
 * the two null cases. On first encounter, kicks off an async load and
 * subscribes `onLoad` to both the success and failure callbacks — so a
 * failed image still triggers a re-render that paints the placeholder.
 */
export function getOrLoadImage(
  src: string,
  onLoad: () => void,
): HTMLImageElement | null {
  const cached = imageCache.get(src);
  if (cached) {
    if (cached.complete && cached.naturalWidth > 0) return cached;
    if (!cached.complete) {
      let cbs = pendingCallbacks.get(src);
      if (!cbs) {
        cbs = new Set();
        pendingCallbacks.set(src, cbs);
      }
      cbs.add(onLoad);
    }
    return null;
  }

  const img = new Image();
  imageCache.set(src, img);
  pendingCallbacks.set(src, new Set([onLoad]));

  const flushPending = (): void => {
    const waiting = pendingCallbacks.get(src);
    pendingCallbacks.delete(src);
    if (waiting) {
      for (const cb of waiting) {
        try { cb(); } catch { /* swallow listener errors */ }
      }
    }
  };

  img.onload = flushPending;
  img.onerror = () => {
    failedImages.add(src);
    // Fire callbacks too so the renderer repaints with the placeholder
    // — without this, a slide with a broken image stays blank until
    // the next unrelated repaint.
    flushPending();
  };
  img.src = src;
  return null;
}

/**
 * `true` if the image at `src` has fired `onerror` and will not load
 * (e.g. 404, network error, blocked by CSP). Renderers use this to
 * decide whether to paint a "still loading" no-op or a permanent
 * placeholder.
 */
export function isImageFailed(src: string): boolean {
  return failedImages.has(src);
}

/**
 * Drop specific `src` keys from the cache. Used by PDF export, which
 * loads images under short-lived object-URL keys (to avoid cross-origin
 * canvas tainting) and must release them once the export finishes —
 * otherwise their decoded bitmaps leak for the process lifetime. Only
 * ever called with the export's own unique object URLs, so it never
 * evicts an image the editor is still rendering.
 */
export function evictImageSrcs(srcs: readonly string[]): void {
  for (const src of srcs) {
    imageCache.delete(src);
    pendingCallbacks.delete(src);
    failedImages.delete(src);
  }
}

/** Test-only: drop every cached image and pending callback. */
export function clearImageCacheForTests(): void {
  imageCache.clear();
  pendingCallbacks.clear();
  failedImages.clear();
}
