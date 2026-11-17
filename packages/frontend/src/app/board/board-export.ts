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
import { sceneBounds } from "./minimap-geometry";

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
 * Render the board (or the given top-level `ids`) and download it as a PNG
 * or a one-page PDF sized to the content.
 *
 * Painted by the same `drawSlide` the canvas and minimap use, on the
 * plane's own colour (a transparent PNG would put the board's dark text on
 * whatever the viewer's background is). Fonts and cross-origin images are
 * made ready first, as the slides PDF export does. Read-only: it never
 * touches the document, so a viewer can export.
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
  const region = slide ? boardExportRegion(slide.elements, opts.ids) : undefined;
  if (!slide || !region) throw new Error("Nothing to export.");
  await loadDeckFonts(opts.doc);
  const options = {
    scale: BOARD_EXPORT_SCALE,
    background: BOARD_PLANE_BACKGROUND,
    elementIds: opts.ids,
    imageFetcher: docsImageFetcher,
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
