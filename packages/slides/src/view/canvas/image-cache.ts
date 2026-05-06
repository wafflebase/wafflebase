/**
 * Per-process cache of loaded `HTMLImageElement`s, keyed by `src`.
 * Mirrors `packages/docs/src/view/image-cache.ts` so the two packages
 * behave the same way; we copy rather than import because docs does
 * not export this helper from its public API.
 */
const imageCache = new Map<string, HTMLImageElement>();
const pendingCallbacks = new Map<string, Set<() => void>>();

/**
 * Return a loaded `HTMLImageElement` for `src`, or `null` if it is
 * still loading. On first encounter, kicks off an async load and
 * subscribes `onLoad` to the load-completion callbacks.
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

  img.onload = () => {
    const waiting = pendingCallbacks.get(src);
    pendingCallbacks.delete(src);
    if (waiting) {
      for (const cb of waiting) {
        try { cb(); } catch { /* swallow listener errors */ }
      }
    }
  };
  img.onerror = () => {
    pendingCallbacks.delete(src);
  };
  img.src = src;
  return null;
}

/** Test-only: drop every cached image and pending callback. */
export function clearImageCacheForTests(): void {
  imageCache.clear();
  pendingCallbacks.clear();
}
