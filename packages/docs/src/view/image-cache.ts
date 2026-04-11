/**
 * Shared cache of loaded inline images for the Canvas renderer. Populated
 * lazily on first render and reused across every DocCanvas / table-renderer
 * invocation so switching documents or scrolling does not re-fetch images.
 */
const imageCache = new Map<string, HTMLImageElement>();

/**
 * Callbacks waiting on in-flight image loads, keyed by src. When an image
 * load kicks off from one render, any subsequent call from another render
 * path (body renderer, table renderer, a second DocCanvas instance)
 * subscribes here so every interested caller gets notified when the load
 * resolves. Without this, later callers' onLoad would be silently dropped
 * and their canvas would never repaint with the image.
 */
const pendingImageCallbacks = new Map<string, Set<() => void>>();

/**
 * Return a loaded HTMLImageElement for the given src, or null if it is
 * still loading. On first encounter, kicks off an async load and invokes
 * `onLoad` once the image is ready so the caller can trigger a re-render.
 * When the image is already loading from a previous call, the caller is
 * subscribed to the in-flight load so its onLoad still fires.
 */
export function getOrLoadImage(
  src: string,
  onLoad: () => void,
): HTMLImageElement | null {
  const cached = imageCache.get(src);
  if (cached) {
    if (cached.complete && cached.naturalWidth > 0) return cached;
    // Still loading (or failed with naturalWidth === 0). Subscribe only
    // while the image is not yet complete so that in-flight loads notify
    // every waiting callback.
    if (!cached.complete) {
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
  const callbacks = new Set<() => void>([onLoad]);
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
