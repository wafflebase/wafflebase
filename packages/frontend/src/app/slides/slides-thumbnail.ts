import {
  SLIDE_WIDTH,
  deckSlideHeight,
  renderThumbnail,
  type SlidesDocument,
} from "@wafflebase/slides";

/**
 * How long to wait for images referenced by the slide to arrive before
 * accepting the paint. `renderThumbnail` paints synchronously with whatever
 * is already in the asset cache and calls back when a late one lands.
 */
const ASSET_SETTLE_MS = 300;

/**
 * The deck's picture for the template gallery: **the first slide**, rendered
 * offscreen at its own logical size.
 *
 * Offscreen rather than reading the editor's canvas, because the author is
 * usually not looking at slide 1 when they publish, and a deck's cover is what
 * a template is recognised by. `renderThumbnail` is the same call the left-rail
 * thumbnail panel makes, so the pixels match what the editor shows.
 */
export function renderDeckThumbnail(
  doc: SlidesDocument,
): Promise<HTMLCanvasElement | null> {
  return renderSlideCanvas(doc, 0);
}

/**
 * Paint slide `index` offscreen at the deck's logical size
 * (`SLIDE_WIDTH` x `deckSlideHeight`, 1:1 pixels) with the same
 * `renderThumbnail` call the left rail uses. `null` when there is no such
 * slide or no 2D context. Shared by the template thumbnail (slide 0) and the
 * `slides render` CLI hook (every slide).
 */
export function renderSlideCanvas(
  doc: SlidesDocument,
  index: number,
): Promise<HTMLCanvasElement | null> {
  const slide = doc.slides?.[index];
  if (!slide) return Promise.resolve(null);

  const canvas = document.createElement("canvas");
  const width = SLIDE_WIDTH;
  const height = deckSlideHeight(doc.meta);
  canvas.width = Math.round(width);
  canvas.height = Math.round(height);
  const ctx = canvas.getContext("2d");
  if (!ctx) return Promise.resolve(null);

  const options = { hostWidth: width, hostHeight: height, dpr: 1 };
  return new Promise((resolve) => {
    let assetArrived = false;
    renderThumbnail(ctx, slide, doc, options, () => {
      assetArrived = true;
    });
    // One repaint if an image loaded after the first pass — the cache is
    // usually warm (the editor opened on this slide), so the common path
    // pays only the wait.
    setTimeout(() => {
      if (assetArrived) renderThumbnail(ctx, slide, doc, options);
      resolve(canvas);
    }, ASSET_SETTLE_MS);
  });
}
