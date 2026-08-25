import type { SlidesDocument } from "@wafflebase/slides";
import { collectFontFamilies, exportSlidesPdf } from "@wafflebase/slides";
import { ensureFontLink } from "@/components/text-formatting/font-catalog";
import { docsImageFetcher, downloadBlob, safeFilename } from "../docs/export-utils";

/** How long the export waits for the used families' stylesheets before
 *  painting with whatever is loaded. */
const FONT_CSS_TIMEOUT_MS = 5_000;

/**
 * Render the presentation to a PDF (one slide per page) and trigger a
 * browser download.
 *
 * Two things must be ready before the raster pipeline paints, and both
 * are the frontend's responsibility because the slides package can't
 * reach the app's font CSS or auth cookies:
 *
 *   1. Fonts — lazy Google Fonts on slides the user never opened may not
 *      be in `document.fonts` yet. We inject every used family's `<link>`,
 *      wait for that stylesheet to parse, and only then await
 *      `document.fonts.load` so text measures and paints with the right
 *      glyphs instead of a fallback.
 *
 *      THE STYLESHEET WAIT IS THE LOAD-BEARING HALF. `ensureFontLink`
 *      appends an element; the family's `@font-face` rules arrive over the
 *      network afterwards. Asking the Font Loading API before they do gets
 *      an answer about whichever faces happen to be connected — none (so
 *      `load()` resolves instantly and the deck rasterises in a fallback),
 *      or the picker's `&text=` preview subset for that family, which would
 *      export a deck containing only the glyphs a dropdown row painted.
 *   2. Images — `exportSlidesPdf` fetches each image's bytes through the
 *      injected `docsImageFetcher` (credentialed) into a same-origin
 *      object URL, so cross-origin backend images don't taint the canvas.
 *
 * pdf-lib itself is dynamically imported inside `exportSlidesPdf`, so it
 * stays out of the editor bundle until the user actually exports.
 */
export async function exportSlidesPdfAndDownload(
  doc: SlidesDocument,
  title: string,
  onProgress?: (done: number, total: number, phase: string) => void,
): Promise<void> {
  const families = collectFontFamilies(doc);
  // Bounded: a stylesheet that neither loads nor errors (an offline tab, a CSP
  // that swallows the request) must cost the export a few seconds, not the
  // whole download. Falling through early is the pre-existing behaviour.
  await Promise.race([
    Promise.all(families.map((family) => ensureFontLink(family))),
    new Promise((resolve) => setTimeout(resolve, FONT_CSS_TIMEOUT_MS)),
  ]);
  if (typeof document !== "undefined" && document.fonts) {
    await Promise.all(
      families.map((family) =>
        document.fonts.load(`16px "${family}"`).catch(() => {
          /* a single font failing to load must not abort the export */
        }),
      ),
    );
  }

  const bytes = await exportSlidesPdf(doc, {
    imageFetcher: docsImageFetcher,
    title,
    onProgress,
  });
  const blob = new Blob([bytes], { type: "application/pdf" });
  downloadBlob(blob, safeFilename(title, "pdf"));
}
