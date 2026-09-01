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
 * Both hold, and they never apply to the same host: only **our own** image
 * routes can be relied on to answer with the header. So CORS is requested for
 * those origins and nowhere else. A third-party URL is loaded exactly as it
 * was before this existed — no extra request, no behaviour change, and a
 * tainted canvas, which is the honest price of rendering it at all.
 *
 * The mode is `use-credentials`, not `anonymous`, and that distinction is the
 * whole feature: `anonymous` sets the request's credentials mode to
 * `same-origin`, so a cross-origin load sends no cookie — and the SPA and the
 * API are on different origins in every environment we ship. The workspace
 * image route (`GET /api/v1/workspaces/:wid/images/:id`) authorizes on that
 * cookie, so an `anonymous` request would be refused with 403, fall back to
 * the plain retry, and taint the canvas anyway while costing an extra round
 * trip per image on the main render path. The API answers with a specific
 * `Access-Control-Allow-Origin` plus `Access-Control-Allow-Credentials: true`,
 * which is exactly what `use-credentials` requires.
 *
 * Kept here rather than duplicated three times because the ordering is subtle:
 * the retry has to replace the caller's cached element, or a later draw finds
 * the one that already failed.
 */

/**
 * Origins whose images are requested with credentialed CORS. Empty by default,
 * so a consumer that never configures this (tests, a non-browser build) gets
 * exactly the pre-existing plain-`<img>` behaviour.
 */
let credentialedOrigins: readonly string[] = [];

/**
 * Declare the origins that serve *our* images — normally just the API origin.
 *
 * Configuration rather than a constant because the packages this lives in are
 * engines: they have no `import.meta.env`, and the API origin is the app's
 * fact, not theirs. Mirrors the `setImageUrlResolver` seam the caches already
 * expose.
 */
export function setCredentialedImageOrigins(origins: readonly string[]): void {
  credentialedOrigins = origins.filter((origin) => origin.length > 0);
}

/** Whether `src` should be requested with credentialed CORS. */
function wantsCors(src: string): boolean {
  if (credentialedOrigins.length === 0) return false;
  try {
    const { origin } = new URL(src, globalThis.location?.href);
    return credentialedOrigins.includes(origin);
  } catch {
    // A `data:` / `blob:` URL, or something unparseable. Neither needs CORS:
    // `data:` and `blob:` do not taint the canvas in the first place.
    return false;
  }
}

export interface LoadImageCallbacks {
  /** The image finished loading and is safe to draw. */
  onLoad: () => void;
  /** The image will never load, with CORS or without it. */
  onError: () => void;
  /**
   * The CORS attempt failed and `img` is the plain retry that replaced it.
   * The caller must point its cache at `img` — the element handed back by
   * {@link loadImage} is no longer the one that will load.
   */
  onRetry: (img: HTMLImageElement) => void;
}

/**
 * Start loading `src`. Images on a {@link setCredentialedImageOrigins} origin
 * are requested with credentialed CORS and retried once plainly if that fails;
 * everything else is loaded plainly to begin with.
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
    if (withCors) img.crossOrigin = 'use-credentials';
    img.onload = onLoad;
    img.onerror = () => {
      if (withCors) {
        // Our own origin refused a credentialed load — a misconfigured CORS
        // allowlist, or an image belonging to a *different* deployment. Render
        // it anyway; only the readback is lost.
        onRetry(attempt(false));
        return;
      }
      onError();
    };
    img.src = src;
    return img;
  };
  return attempt(wantsCors(src));
}
