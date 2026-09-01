/**
 * Shared browser image loading for the canvas renderers.
 *
 * Every engine that paints images onto a canvas — Slides, Docs, Sheets —
 * needs the same two things, and they pull in opposite directions:
 *
 * - **Third-party image URLs must render.** A blog, Wikipedia, a WordPress
 *   CDN: most send no `Access-Control-Allow-Origin`, and an `<img>` that asks
 *   for CORS against such a host fails outright rather than falling back. This
 *   is why the loaders originally set no `crossOrigin` at all.
 * - **The canvas must stay readable.** Drawing an image fetched without CORS
 *   taints the canvas, and a tainted canvas makes `toBlob` / `toDataURL`
 *   throw `SecurityError`. Anything that reads pixels back — the template
 *   gallery's thumbnail capture (docs/design/template-gallery.md) — gets
 *   nothing for any document holding a single remote image.
 *
 * Asking for CORS **and retrying without it** satisfies both, because the two
 * requirements never apply to the same host. Our own image bucket answers with
 * the header (the API enables CORS for the app origin), so its images load on
 * the first attempt and leave the canvas readable. A host that does not answer
 * with it costs one failed request and then loads exactly as it did before,
 * tainting the canvas exactly as it did before.
 *
 * Kept here rather than duplicated three times because the ordering is subtle:
 * the retry has to replace the caller's cached element, or a later draw finds
 * the failed one.
 */

export interface LoadImageCallbacks {
  /** The image finished loading and is safe to draw. */
  onLoad: () => void;
  /** The image will never load, under CORS or without it. */
  onError: () => void;
  /**
   * The CORS attempt failed and `img` is the plain retry that replaced it.
   * The caller must point its cache at `img` — the element handed back by
   * {@link loadImage} is no longer the one that will load.
   */
  onRetry: (img: HTMLImageElement) => void;
}

/**
 * Start loading `src`, asking for CORS first and retrying without it once.
 *
 * Returns the element immediately (still loading). Exactly one of `onLoad` or
 * `onError` fires, and `onRetry` may fire once before either.
 */
export function loadImage(
  src: string,
  { onLoad, onError, onRetry }: LoadImageCallbacks,
): HTMLImageElement {
  const attempt = (withCors: boolean): HTMLImageElement => {
    const img = new Image();
    // Set before `src`: assigning `crossOrigin` after the load has started
    // has no effect on the request already in flight.
    if (withCors) img.crossOrigin = 'anonymous';
    img.onload = onLoad;
    img.onerror = () => {
      if (withCors) {
        onRetry(attempt(false));
        return;
      }
      onError();
    };
    img.src = src;
    return img;
  };
  return attempt(true);
}
