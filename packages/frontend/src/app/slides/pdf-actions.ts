import type { SlidesDocument } from "@wafflebase/slides";
import { collectFontFamilies, exportSlidesPdf } from "@wafflebase/slides";
import { ensureFontLink } from "@/components/text-formatting/font-catalog";
import { docsImageFetcher, downloadBlob, safeFilename } from "../docs/export-utils";

/**
 * Render the presentation to a PDF (one slide per page) and trigger a
 * browser download.
 *
 * Two things must be ready before the raster pipeline paints, and both
 * are the frontend's responsibility because the slides package can't
 * reach the app's font CSS or auth cookies:
 *
 *   1. Fonts — lazy Google Fonts on slides the user never opened may not
 *      be in `document.fonts` yet. We inject every used family's `<link>`
 *      and await `document.fonts.load` so text measures and paints with
 *      the right glyphs instead of a fallback.
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
): Promise<void> {
  const families = collectFontFamilies(doc);
  for (const family of families) ensureFontLink(family);
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
  });
  const blob = new Blob([bytes], { type: "application/pdf" });
  downloadBlob(blob, safeFilename(title, "pdf"));
}
