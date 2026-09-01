/**
 * Thumbnail capture for the template gallery
 * (docs/design/template-gallery.md).
 *
 * A gallery without thumbnails is a list of titles, and the backend has no
 * canvas — every renderer we have is in the browser. So the picture is taken
 * client-side, at publish time, by whichever editor is currently mounted.
 *
 * The editor registers a *source*; the Share dialog asks for a picture. That
 * indirection is the whole point: the dialog lives in `components/` and must
 * not know that a deck is painted differently from a spreadsheet, and an
 * editor must not know the template gallery exists.
 *
 * Everything here degrades to `null` rather than throwing. A thumbnail is
 * decoration: failing to take one must never fail the publish it rides along
 * with.
 */

/** Longest edge of the encoded thumbnail, in pixels. */
const MAX_EDGE = 640;

/** WebP quality. High enough that text in a captured page stays legible. */
const WEBP_QUALITY = 0.82;

/**
 * A canvas showing the document, or `null` when there is nothing to show.
 * The caller owns nothing: the returned canvas may be the live editor canvas,
 * so this module only ever *reads* it.
 */
export type ThumbnailSource = () =>
  | HTMLCanvasElement
  | null
  | Promise<HTMLCanvasElement | null>;

/**
 * Keyed by document id, not a bare singleton, so a source left behind by an
 * editor that has not finished unmounting cannot be captured for the document
 * that replaced it.
 */
const sources = new Map<string, ThumbnailSource>();

/** Register `source` for `documentId`. Returns the deregistration. */
export function registerThumbnailSource(
  documentId: string,
  source: ThumbnailSource,
): () => void {
  sources.set(documentId, source);
  return () => {
    // Only if it is still ours: a remount registers the new source before
    // React runs the old effect's cleanup, and deleting unconditionally would
    // leave the document with no source at all.
    if (sources.get(documentId) === source) sources.delete(documentId);
  };
}

/** Whether an editor is mounted that can take this document's picture. */
export function hasThumbnailSource(documentId: string): boolean {
  return sources.has(documentId);
}

/**
 * Take the document's picture, downscaled and encoded, or `null`.
 *
 * `null` is an ordinary outcome, not an error: no editor is mounted, the
 * document type has no renderer, the canvas is empty — or the canvas is
 * **tainted**. That last one is a real and current limitation: the editors
 * load images without `crossOrigin` (deliberately, so third-party image URLs
 * render at all — see `app/docs/image-insert.ts`), so any document holding a
 * remote image poisons the canvas for `toBlob` and gets no thumbnail. Such a
 * card falls back to its document-type icon, which is what every card did
 * before this existed.
 */
export async function captureThumbnail(
  documentId: string,
): Promise<Blob | null> {
  const source = sources.get(documentId);
  if (!source) return null;

  let canvas: HTMLCanvasElement | null;
  try {
    canvas = await source();
  } catch {
    return null;
  }
  if (!canvas) return null;
  return encodeThumbnail(canvas);
}

/**
 * Downscale `canvas` to fit {@link MAX_EDGE} and encode it.
 *
 * WebP with a PNG fallback: `toBlob` answers `null` for a format the browser
 * cannot encode, and a thumbnail in the wrong format beats no thumbnail.
 */
export async function encodeThumbnail(
  canvas: HTMLCanvasElement,
): Promise<Blob | null> {
  const { width, height } = canvas;
  if (!(width > 0) || !(height > 0)) return null;

  const scale = Math.min(1, MAX_EDGE / Math.max(width, height));
  const target = document.createElement("canvas");
  target.width = Math.max(1, Math.round(width * scale));
  target.height = Math.max(1, Math.round(height * scale));
  const ctx = target.getContext("2d");
  if (!ctx) return null;

  // A canvas drawn on nothing is transparent, and a transparent thumbnail
  // reads as a broken image on a light card. Paint the page under it.
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, target.width, target.height);
  try {
    ctx.drawImage(canvas, 0, 0, target.width, target.height);
  } catch {
    return null;
  }

  return (
    (await toBlob(target, "image/webp", WEBP_QUALITY)) ??
    (await toBlob(target, "image/png"))
  );
}

/**
 * Composite every canvas inside `container` into one, positioned as the user
 * sees them.
 *
 * The source for editors whose paint path is private to the mounted view
 * (`doc`, `sheet`, `board`): there is no offscreen renderer to call, but the
 * canvas on screen was painted by the very same code. Multiple canvases are
 * composited because these editors layer them — a spreadsheet paints its grid
 * and its selection overlay separately, and only the pair is the picture.
 *
 * Thin canvases are skipped: a ruler or a scrollbar gutter is chrome, not
 * content, and including it puts a grey stripe down the side of every card.
 */
export function captureFromContainer(
  container: HTMLElement | null,
): HTMLCanvasElement | null {
  if (!container) return null;
  const host = container.getBoundingClientRect();
  if (!(host.width > 0) || !(host.height > 0)) return null;

  const out = document.createElement("canvas");
  out.width = Math.round(host.width);
  out.height = Math.round(host.height);
  const ctx = out.getContext("2d");
  if (!ctx) return null;

  let painted = false;
  for (const canvas of container.querySelectorAll("canvas")) {
    const rect = canvas.getBoundingClientRect();
    if (rect.width < MIN_CONTENT_EDGE || rect.height < MIN_CONTENT_EDGE) {
      continue;
    }
    try {
      ctx.drawImage(
        canvas,
        rect.left - host.left,
        rect.top - host.top,
        rect.width,
        rect.height,
      );
      painted = true;
    } catch {
      // A canvas that cannot be read (zero-sized bitmap) is skipped rather
      // than abandoning the layers that did draw.
    }
  }
  return painted ? out : null;
}

/**
 * Below this, in CSS pixels, a canvas is chrome rather than content — the
 * docs rulers are 20-odd pixels thick on their short axis.
 */
const MIN_CONTENT_EDGE = 48;

function toBlob(
  canvas: HTMLCanvasElement,
  type: string,
  quality?: number,
): Promise<Blob | null> {
  return new Promise((resolve) => {
    try {
      // Throws `SecurityError` on a canvas tainted by a cross-origin image.
      canvas.toBlob((blob) => resolve(blob), type, quality);
    } catch {
      resolve(null);
    }
  });
}
