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

/**
 * Longest edge of the encoded thumbnail, in pixels.
 *
 * Sized for the largest place a thumbnail is shown, which is not the gallery
 * card: `/t/:id` renders it across a `max-w-3xl` column, about 720 CSS px, and
 * on a 2× display that is ~1440 device pixels. At 640 the landing page was
 * upscaling more than twice and looked it. 1280 covers the card at 2× as well,
 * since a card is ~640 CSS px at its widest.
 */
const MAX_EDGE = 1280;

/**
 * Ceiling on the device-pixel ratio a capture composites at. Retina bitmaps
 * are worth reading at their real size — compositing at CSS pixels threw away
 * half of every docs and sheet capture before it was even downscaled — but a
 * 3× display would quadruple the work for pixels {@link MAX_EDGE} discards.
 */
const MAX_CAPTURE_DPR = 2;

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
  } catch (err) {
    // Degrade, but say so. Silently swallowing this made a real failure —
    // a deck whose images tainted the canvas — indistinguishable from a
    // document type that simply has no renderer, and the difference took a
    // database query and a Yorkie dump to recover.
    warn('the editor could not render one', err);
    return null;
  }
  if (!canvas) {
    warn('the editor had nothing to render');
    return null;
  }
  const blob = await encodeThumbnail(canvas);
  if (!blob) {
    warn(
      'the canvas could not be encoded — most likely tainted by a ' +
        'cross-origin image, which no document holding one can avoid yet',
    );
  }
  return blob;
}

function warn(reason: string, err?: unknown): void {
  console.warn(`[thumbnail] no thumbnail captured: ${reason}`, err ?? '');
}

/**
 * Downscale `canvas` to fit {@link MAX_EDGE} and encode it.
 *
 * No backdrop is painted here. Producing an opaque canvas is the *source's*
 * job, because only the source knows what colour "empty" is — a hardcoded
 * white fill here put a white band across the top of every dark-mode docs
 * thumbnail, where the skipped ruler strip left nothing drawn.
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
  const target = document.createElement('canvas');
  target.width = Math.max(1, Math.round(width * scale));
  target.height = Math.max(1, Math.round(height * scale));
  const ctx = target.getContext('2d');
  if (!ctx) return null;

  try {
    ctx.drawImage(canvas, 0, 0, target.width, target.height);
  } catch {
    return null;
  }

  return (
    (await toBlob(target, 'image/webp', WEBP_QUALITY)) ??
    (await toBlob(target, 'image/png'))
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
 * content, and including it puts a stripe down the side of every card.
 *
 * The result is cropped to **what was actually drawn**, not to the container.
 * The docs ruler takes 20 px of the container's flow before the page canvas
 * starts, so cropping to the container left that strip unpainted — a white
 * band across the top of every dark-mode card. What is skipped as chrome must
 * also be outside the picture, or it is not skipped at all.
 */
export function captureFromContainer(
  container: HTMLElement | null,
): HTMLCanvasElement | null {
  if (!container) return null;

  const layers: Array<{ canvas: HTMLCanvasElement; rect: DOMRect }> = [];
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const canvas of container.querySelectorAll('canvas')) {
    const rect = canvas.getBoundingClientRect();
    if (rect.width < MIN_CONTENT_EDGE || rect.height < MIN_CONTENT_EDGE) {
      continue;
    }
    layers.push({ canvas, rect });
    left = Math.min(left, rect.left);
    top = Math.min(top, rect.top);
    right = Math.max(right, rect.right);
    bottom = Math.max(bottom, rect.bottom);
  }
  const width = Math.round(right - left);
  const height = Math.round(bottom - top);
  if (layers.length === 0 || !(width > 0) || !(height > 0)) return null;

  // Composite at device pixels, not CSS pixels. `getBoundingClientRect` is in
  // CSS pixels while the editor's bitmap is `dpr` times that, so sizing the
  // output to the rect resampled a retina capture down to 1× before
  // `encodeThumbnail` had even looked at it — half the resolution thrown away
  // for nothing. The draw calls below stay in CSS coordinates; the transform
  // does the scaling.
  const dpr = Math.min(window.devicePixelRatio || 1, MAX_CAPTURE_DPR);
  const out = document.createElement('canvas');
  out.width = Math.round(width * dpr);
  out.height = Math.round(height * dpr);
  const ctx = out.getContext('2d');
  if (!ctx) return null;
  ctx.scale(dpr, dpr);

  // A layer may be transparent where it has nothing to say (a selection
  // overlay is almost entirely so), and a thumbnail encoded from a
  // part-transparent canvas reads as the card's own background showing
  // through. The editor's own background is the honest colour to put under
  // it — and, unlike a constant, it is right in both themes.
  ctx.fillStyle = resolveBackgroundColor(container);
  ctx.fillRect(0, 0, width, height);

  let painted = false;
  for (const { canvas, rect } of layers) {
    try {
      ctx.drawImage(
        canvas,
        rect.left - left,
        rect.top - top,
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

/** Fully transparent in every spelling `getComputedStyle` returns. */
const TRANSPARENT = /^(transparent$|rgba\(.*,\s*0\s*\)$)/;

/**
 * The nearest ancestor background that actually paints, walking up from
 * `element`. Elements in this app are overwhelmingly transparent — the theme
 * colour is set once near the root — so the answer is almost never on the
 * container itself. White is the last resort, matching a browser's own
 * default canvas.
 */
function resolveBackgroundColor(element: HTMLElement): string {
  for (
    let el: HTMLElement | null = element;
    el;
    el = el.parentElement as HTMLElement | null
  ) {
    const color = getComputedStyle(el).backgroundColor;
    if (color && !TRANSPARENT.test(color)) return color;
  }
  return '#ffffff';
}

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
