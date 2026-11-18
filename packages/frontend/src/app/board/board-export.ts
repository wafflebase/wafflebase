import {
  exportSlideRegionPdf,
  rasterizeSlideRegion,
  type Element,
  type SlidesDocument,
  type WorldRegion,
} from "@wafflebase/slides";
import { docsImageFetcher, downloadBlob, safeFilename } from "../docs/export-utils";
import { loadDeckFonts } from "../slides/pdf-actions";
import { BOARD_PLANE_BACKGROUND } from "./board-plane";
import { paintSections } from "./board-section-paint";
import { sceneBounds } from "./minimap-geometry";
import { hiddenSectionContentIds } from "./rituals/hidden-content";

/** World px of plane kept around the exported content. */
export const BOARD_EXPORT_PAD = 40;

/** PNG supersampling: crisp on a retina screen and in a slide deck. */
export const BOARD_EXPORT_SCALE = 2;

export type BoardExportFormat = "png" | "pdf";

/**
 * The world rect an export covers: every element, or only `ids` when given
 * (an exported selection), padded by {@link BOARD_EXPORT_PAD}. `undefined`
 * when there is nothing to export. Pure.
 */
export function boardExportRegion(
  elements: readonly Element[],
  ids?: readonly string[],
): WorldRegion | undefined {
  const keep = ids ? new Set(ids) : null;
  const frames = elements
    .filter((e) => !keep || keep.has(e.id))
    .map((e) => e.frame);
  return sceneBounds(frames, BOARD_EXPORT_PAD);
}

/**
 * What an export paints, from the whole board's top-level `elements` and
 * an optional selection `ids`:
 *
 * - `elementIds` — the elements rasterized: the selection (or everything)
 *   minus the contents of every hidden section. Hidden contents are left
 *   out rather than merely covered, so no paint order, translucent cover
 *   or selection that names a member but not its section can put them in
 *   the file.
 * - `sectionElements` — what the section pass ({@link paintSections})
 *   reads: the exported sections plus the hidden contents, so a cover
 *   counts its hidden items as the canvas does, and a section left out of
 *   a selection export paints neither title nor cover.
 * - `region` — the bounds of the painted elements, padded; `undefined`
 *   when nothing is left to paint.
 *
 * Pure.
 */
export function boardExportPlan(
  elements: readonly Element[],
  ids?: readonly string[],
): {
  region: WorldRegion | undefined;
  elementIds: string[];
  sectionElements: Element[];
} {
  const hidden = hiddenSectionContentIds(elements);
  const scope = ids ? new Set(ids) : null;
  const elementIds = elements
    .filter((e) => (!scope || scope.has(e.id)) && !hidden.has(e.id))
    .map((e) => e.id);
  const painted = new Set(elementIds);
  const sectionElements = elements.filter((e) => painted.has(e.id) || hidden.has(e.id));
  return {
    region: elementIds.length ? boardExportRegion(elements, elementIds) : undefined,
    elementIds,
    sectionElements,
  };
}

/**
 * Render the board (or the given top-level `ids`) and download it as a PNG
 * or a one-page PDF sized to the content.
 *
 * Painted by the same `drawSlide` the canvas and minimap use, with the
 * same section pass (titles and hidden-section covers, see
 * {@link boardExportPlan}), on the plane's own colour (a transparent PNG would put the board's dark text on
 * whatever the viewer's background is). Fonts and cross-origin images are
 * made ready first, as the slides PDF export does. Read-only: it never
 * touches the document, so a viewer can export.
 *
 * Stamps, vote badges and comment pins are not exported: they are DOM
 * layers over the canvas, not document content, and a vote in progress
 * or a comment thread is not meant to travel with a picture of the board.
 *
 * Throws when there is nothing to export; the caller reports it.
 */
export async function exportBoard(opts: {
  doc: SlidesDocument;
  format: BoardExportFormat;
  title: string;
  ids?: readonly string[];
}): Promise<void> {
  const slide = opts.doc.slides[0];
  const plan = slide ? boardExportPlan(slide.elements, opts.ids) : undefined;
  const region = plan?.region;
  if (!slide || !plan || !region) throw new Error("Nothing to export.");
  await loadDeckFonts(opts.doc);
  const options = {
    scale: BOARD_EXPORT_SCALE,
    background: BOARD_PLANE_BACKGROUND,
    elementIds: plan.elementIds,
    imageFetcher: docsImageFetcher,
    // Titles at their 100%-zoom size: the export is a picture of the
    // board's world, not of whatever zoom the viewer happened to be at.
    paintAfterElements: (ctx: CanvasRenderingContext2D) =>
      paintSections(ctx, plan.sectionElements, 1),
  };
  if (opts.format === "png") {
    const { bytes } = await rasterizeSlideRegion(opts.doc, slide, region, options);
    const blob = new Blob([bytes as Uint8Array<ArrayBuffer>], { type: "image/png" });
    downloadBlob(blob, safeFilename(opts.title, "png"));
    return;
  }
  const bytes = await exportSlideRegionPdf(opts.doc, slide, region, {
    ...options,
    title: opts.title,
  });
  const blob = new Blob([bytes as Uint8Array<ArrayBuffer>], { type: "application/pdf" });
  downloadBlob(blob, safeFilename(opts.title, "pdf"));
}
