import { loadImage } from '@wafflebase/core/image';

/**
 * Per-process cache of loaded `HTMLImageElement`s, keyed by `src`.
 * Mirrors `packages/docs/src/view/image-cache.ts` so the two packages
 * behave the same way; we copy rather than import because docs does
 * not export this helper from its public API. The one part that is NOT
 * copied is how the element is loaded — that lives in
 * `@wafflebase/core/image`, because the CORS-then-retry ordering is subtle
 * enough that three divergent copies of it would be a defect waiting to
 * happen.
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
 * Maps a CRDT-stored `src` to the URL actually fetched. Identity by default;
 * a shared-link mount installs a resolver that appends its `?token=` to
 * workspace image URLs so anonymous viewers can load them (the stored `src`
 * is shared across all viewers and cannot itself carry a per-viewer token).
 * Applied wherever a `src` becomes a cache key so `getOrLoadImage` and
 * `isImageFailed` agree on the key.
 */
let urlResolver: (src: string) => string = (s) => s;

/**
 * Install (or clear, with `null`) the src → fetch-URL resolver. The resolver
 * must be idempotent and leave non-workspace URLs (data:, blob:, external)
 * untouched. Set on a shared-link mount, cleared on unmount.
 */
export function setImageUrlResolver(
  resolver: ((src: string) => string) | null,
): void {
  urlResolver = resolver ?? ((s) => s);
}

/**
 * Return a loaded `HTMLImageElement` for `src`, or `null` if it is
 * still loading OR has failed. Use `isImageFailed(src)` to distinguish
 * the two null cases. On first encounter, kicks off an async load and
 * subscribes `onLoad` to both the success and failure callbacks — so a
 * failed image still triggers a re-render that paints the placeholder.
 */
export function getOrLoadImage(
  logicalSrc: string,
  onLoad: () => void,
): HTMLImageElement | null {
  const src = urlResolver(logicalSrc);
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

  // CORS first, plain retry on failure (@wafflebase/core/image). Our own
  // bucket answers with the header, so its images leave the canvas readable
  // and the thumbnail capture in the template gallery can encode it; a
  // third-party host that does not costs one failed request and then renders
  // exactly as before.
  imageCache.set(
    src,
    loadImage(src, {
      onLoad: flushPending,
      onError: () => {
        failedImages.add(src);
        // Fire callbacks too so the renderer repaints with the placeholder
        // — without this, a slide with a broken image stays blank until
        // the next unrelated repaint.
        flushPending();
      },
      // The retry is a different element; the cache has to follow it or a
      // later draw finds the one that already failed.
      onRetry: (retry) => imageCache.set(src, retry),
    }),
  );
  return null;
}

/**
 * `true` if the image at `src` has fired `onerror` and will not load
 * (e.g. 404, network error, blocked by CSP). Renderers use this to
 * decide whether to paint a "still loading" no-op or a permanent
 * placeholder.
 */
export function isImageFailed(src: string): boolean {
  return failedImages.has(urlResolver(src));
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
  for (const logicalSrc of srcs) {
    // Entries are keyed by the RESOLVED url (see getOrLoadImage), so evict by
    // the same key or a non-identity resolver would leak the cached bitmap.
    const src = urlResolver(logicalSrc);
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
  urlResolver = (s) => s;
}
