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
export const THUMBNAIL_MAX_EDGE = 1280;

/**
 * Width over height of the box every thumbnail is shown in: the gallery card
 * and the `/t/:id` landing page are both `aspect-[16/10]`, `object-contain`.
 * A source that chooses its own framing (a sheet's used range, a board's
 * content bounds) frames to this, so the picture fills the card instead of
 * floating in bands of wash.
 */
export const THUMBNAIL_ASPECT = 16 / 10;

/**
 * Ceiling on the device-pixel ratio a capture composites at. Retina bitmaps
 * are worth reading at their real size — compositing at CSS pixels threw away
 * half of every docs and sheet capture before it was even downscaled — but a
 * 3× display would quadruple the work for pixels {@link THUMBNAIL_MAX_EDGE} discards.
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
 * **tainted**. Our own images no longer taint it (`@wafflebase/core/image`
 * requests them with credentialed CORS), but a third-party image URL still
 * does, deliberately: most such hosts send no `Access-Control-Allow-Origin`,
 * and rendering the image matters more than reading the canvas back. Such a
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
    warn("the editor could not render one", err);
    return null;
  }
  if (!canvas) {
    warn("the editor had nothing to render");
    return null;
  }
  const blob = await encodeThumbnail(canvas);
  if (!blob) {
    warn(
      "the canvas could not be encoded — most likely tainted by a " +
        "third-party image, which sends no CORS header and so cannot be " +
        "read back",
    );
  }
  return blob;
}

function warn(reason: string, err?: unknown): void {
  console.warn(`[thumbnail] no thumbnail captured: ${reason}`, err ?? "");
}

/**
 * Downscale `canvas` to fit {@link THUMBNAIL_MAX_EDGE} and encode it.
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

  const scale = Math.min(1, THUMBNAIL_MAX_EDGE / Math.max(width, height));
  const target = document.createElement("canvas");
  target.width = Math.max(1, Math.round(width * scale));
  target.height = Math.max(1, Math.round(height * scale));
  const ctx = target.getContext("2d");
  if (!ctx) return null;

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

/** A rectangle in CSS (or world) pixels. */
export interface FrameRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface FrameOptions {
  /** Space added around the content: every side, or only right and bottom for `start`. */
  pad?: number;
  /** Width / height to grow the frame to. Omit to keep the content's own shape. */
  aspect?: number;
  minWidth?: number;
  minHeight?: number;
  maxWidth?: number;
  maxHeight?: number;
  /**
   * `center` grows and shrinks around the content's centre (a board, whose
   * plane extends in every direction). `start` pins the top-left corner and
   * moves only the right and bottom edges (a sheet, which has nothing above
   * row 1 or left of column A to show).
   */
  anchor?: "center" | "start";
}

/**
 * The frame a thumbnail should show around `content`. Pure.
 *
 * In order: pad, grow to the minimum size, grow the short side to `aspect`,
 * then shrink both sides by one factor until the maximum holds — one factor so
 * the aspect survives the clamp. Growing rather than cropping to the aspect is
 * the point: what is added is more of the document's own surface (empty grid,
 * empty plane), never less of its content. Only the maximum can cut content,
 * and it exists for a sheet whose data runs past what a card can show legibly.
 */
export function frameContent(
  content: FrameRect,
  {
    pad = 0,
    aspect,
    minWidth = 0,
    minHeight = 0,
    maxWidth = Infinity,
    maxHeight = Infinity,
    anchor = "center",
  }: FrameOptions = {},
): FrameRect {
  const start = anchor === "start";
  let width = Math.max(0, content.width) + (start ? pad : pad * 2);
  let height = Math.max(0, content.height) + (start ? pad : pad * 2);
  width = Math.max(width, minWidth);
  height = Math.max(height, minHeight);
  if (aspect && aspect > 0 && width > 0 && height > 0) {
    if (width / height < aspect) width = height * aspect;
    else height = width / aspect;
  }
  const shrink = Math.min(1, maxWidth / width, maxHeight / height);
  width *= shrink;
  height *= shrink;

  if (start) return { x: content.x, y: content.y, width, height };
  const cx = content.x + content.width / 2;
  const cy = content.y + content.height / 2;
  return { x: cx - width / 2, y: cy - height / 2, width, height };
}

/**
 * Run `paint` with an editor switched to `target`'s theme, then switch it back.
 *
 * A thumbnail is a picture of the *document*, and a document has one
 * appearance — the light one every reader of a published template sees —
 * whatever the publisher's app theme is. The editors whose paint path is only
 * reachable through the mounted view (docs) are flipped, photographed and
 * flipped back. `paint` must be synchronous: the browser does not paint
 * between the two switches of one task, so the author never sees the flash.
 * The restore runs even when `paint` throws.
 */
export function withTheme<Mode extends string, T>(
  current: Mode,
  target: Mode,
  setTheme: (mode: Mode) => void,
  paint: () => T,
): T {
  if (current === target) return paint();
  setTheme(target);
  try {
    return paint();
  } finally {
    setTheme(current);
  }
}

/**
 * A detached-looking host for an offscreen editor mount: in the document (an
 * engine measures its container and its canvases need a layout box) but
 * parked far outside the viewport, inert and unseen. Returns the host and its
 * removal.
 */
export function mountOffscreenHost(
  width: number,
  height: number,
): { host: HTMLDivElement; dispose: () => void } {
  const host = document.createElement("div");
  host.setAttribute("aria-hidden", "true");
  host.inert = true;
  Object.assign(host.style, {
    position: "fixed",
    left: "-100000px",
    top: "0",
    width: `${Math.ceil(width)}px`,
    height: `${Math.ceil(height)}px`,
    overflow: "hidden",
    pointerEvents: "none",
  });
  document.body.appendChild(host);
  return { host, dispose: () => host.remove() };
}

/**
 * Decode encoded image bytes (a renderer that hands back a PNG rather than a
 * canvas) into a canvas the encoder can read. `null` when it cannot be decoded.
 */
export async function canvasFromImageBytes(
  bytes: Uint8Array,
  type = "image/png",
): Promise<HTMLCanvasElement | null> {
  try {
    const bitmap = await createImageBitmap(
      new Blob([bytes as Uint8Array<ArrayBuffer>], { type }),
    );
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close();
    return canvas;
  } catch {
    return null;
  }
}

export interface CaptureOptions {
  /**
   * Fill under transparent layers. Defaults to the container's resolved
   * background, which follows the app theme — pass the document's own
   * surface colour when capturing a document forced to its light appearance.
   */
  background?: string;
  /**
   * Crop to this rectangle, in CSS pixels relative to the container's
   * top-left, instead of to the union of the drawn canvases.
   */
  frame?: FrameRect;
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
 * A canvas marked `data-canvas-chrome` is skipped: the docs rulers and the
 * board minimap live inside the same container as the content, and drawing
 * them puts a stripe down the side of every docs card and a
 * picture-in-picture into the corner of every board one. The marker is
 * deliberately an **opt-out the chrome declares about itself** rather than
 * something inferred here — the first version of this filtered by size, which
 * is what let the 200x150 minimap through while excluding the 20px ruler.
 * Whoever adds the next non-content canvas is the one who knows it is not
 * content.
 *
 * The result is cropped to **what was actually drawn**, not to the container.
 * The docs ruler takes 20 px of the container's flow before the page canvas
 * starts, so cropping to the container left that strip unpainted — a white
 * band across the top of every dark-mode card. What is skipped as chrome must
 * also be outside the picture, or it is not skipped at all.
 */
export function captureFromContainer(
  container: HTMLElement | null,
  options: CaptureOptions = {},
): HTMLCanvasElement | null {
  if (!container) return null;

  const layers: Array<{ canvas: HTMLCanvasElement; rect: DOMRect }> = [];
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const canvas of container.querySelectorAll<HTMLCanvasElement>(
    "canvas:not([data-canvas-chrome])",
  )) {
    const rect = canvas.getBoundingClientRect();
    // A canvas with no area contributes nothing and would corrupt the union.
    if (!(rect.width > 0) || !(rect.height > 0)) continue;
    layers.push({ canvas, rect });
    left = Math.min(left, rect.left);
    top = Math.min(top, rect.top);
    right = Math.max(right, rect.right);
    bottom = Math.max(bottom, rect.bottom);
  }
  if (options.frame) {
    const origin = container.getBoundingClientRect();
    left = origin.left + options.frame.x;
    top = origin.top + options.frame.y;
    right = left + options.frame.width;
    bottom = top + options.frame.height;
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
  const out = document.createElement("canvas");
  out.width = Math.round(width * dpr);
  out.height = Math.round(height * dpr);
  const ctx = out.getContext("2d");
  if (!ctx) return null;
  ctx.scale(dpr, dpr);

  // A layer may be transparent where it has nothing to say (a selection
  // overlay is almost entirely so), and a thumbnail encoded from a
  // part-transparent canvas reads as the card's own background showing
  // through. The editor's own background is the honest colour to put under
  // it — and, unlike a constant, it is right in both themes.
  ctx.fillStyle = options.background ?? resolveBackgroundColor(container);
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
  return "#ffffff";
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
