/**
 * Shared cache of loaded images for the Canvas renderer. Populated lazily
 * on first render and reused across every render call so scrolling or
 * re-renders do not re-fetch images.
 */
const imageCache = new Map<string, HTMLImageElement>();

/**
 * Callbacks waiting on in-flight image loads, keyed by src. When an image
 * load kicks off from one render, any subsequent render call for the same
 * src subscribes here so every interested caller gets notified when the
 * load resolves.
 */
const pendingImageCallbacks = new Map<string, Set<() => void>>();

/**
 * Maps a sheet image's stored `src` to the URL actually fetched. Identity by
 * default; a shared-link mount installs a resolver that appends its `?token=`
 * to workspace image URLs so anonymous viewers can load them.
 *
 * The `src` lives in the CRDT and is shared across every viewer plus the
 * author, so the token cannot be baked in at upload time. Mirrors the slides
 * seam in `packages/slides/src/view/canvas/image-cache.ts`.
 */
let imageUrlResolver: (src: string) => string = (s) => s;

/**
 * Install (or clear, with `null`) the src → fetch-URL resolver. The resolver
 * must be idempotent and leave non-workspace URLs (`data:`, `blob:`,
 * external) untouched. Set on a shared-link mount, cleared on unmount.
 */
export function setImageUrlResolver(
  resolver: ((src: string) => string) | null,
): void {
  imageUrlResolver = resolver ?? ((s) => s);
}

/**
 * The URL to actually fetch for a stored `src`. Every consumer must render
 * this rather than the raw `src` — `image-object-layer` paints an `<img>`
 * whose `src` has to match the one `getOrLoadImage` warmed, or the browser
 * issues a second, un-tokened request that 403s.
 */
export function resolveImageSrc(src: string): string {
  return imageUrlResolver(src);
}

/**
 * Return a loaded HTMLImageElement for the given src, or null if it is
 * still loading. On first encounter, kicks off an async load and invokes
 * `onLoad` once the image is ready so the caller can trigger a re-render.
 * When the image is already loading from a previous call, the caller is
 * subscribed to the in-flight load so its onLoad still fires.
 *
 * `logicalSrc` is the stored value; the cache is keyed by the *resolved* URL
 * so that entries warmed under one share token are never handed to a viewer
 * fetching under another.
 */
export function getOrLoadImage(
  logicalSrc: string,
  onLoad?: () => void,
): HTMLImageElement | null {
  const src = imageUrlResolver(logicalSrc);
  const cached = imageCache.get(src);
  if (cached) {
    if (cached.complete && cached.naturalWidth > 0) return cached;
    // Still loading (or failed with naturalWidth === 0). Subscribe only
    // while the image is not yet complete so that in-flight loads notify
    // every waiting callback.
    if (!cached.complete && onLoad) {
      let callbacks = pendingImageCallbacks.get(src);
      if (!callbacks) {
        callbacks = new Set();
        pendingImageCallbacks.set(src, callbacks);
      }
      callbacks.add(onLoad);
    }
    return null;
  }

  const img = new Image();
  imageCache.set(src, img);
  const callbacks = new Set<() => void>(onLoad ? [onLoad] : []);
  pendingImageCallbacks.set(src, callbacks);

  img.onload = () => {
    const waiting = pendingImageCallbacks.get(src);
    pendingImageCallbacks.delete(src);
    if (waiting) {
      for (const cb of waiting) {
        try {
          cb();
        } catch {
          // Ignore listener errors so that one failing subscriber does
          // not block notifications for the rest.
        }
      }
    }
  };
  img.onerror = () => {
    // Broken image is now cached; subsequent draws will skip it via the
    // `naturalWidth > 0` guard above. Drop any pending callbacks so they
    // are not retained forever.
    pendingImageCallbacks.delete(src);
  };
  img.src = src;
  return null;
}
