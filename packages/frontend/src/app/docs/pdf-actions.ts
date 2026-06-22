import type { Document as DocsDocument } from "@wafflebase/docs";
import { docsImageFetcher, downloadBlob, safeFilename } from "./export-utils";

/**
 * Export the given Document as a PDF file and trigger a browser download.
 *
 * The PDF module (~200 KB gzipped: pdf-lib + fontkit + Noto fonts at runtime)
 * is loaded lazily via dynamic import so the initial app bundle stays
 * unaffected. If finer-grained code-splitting is needed later, we can add a
 * dedicated `@wafflebase/docs/pdf-exporter` sub-path export instead of going
 * through the package main entry.
 */
export async function exportPdfAndDownload(
  doc: DocsDocument,
  title: string,
  metadata?: { title?: string; author?: string },
): Promise<void> {
  // Dynamic import keeps pdf-lib + fontkit out of the initial bundle.
  const { PdfExporter, CanvasTextMeasurer } = await import("@wafflebase/docs");
  // Curated-font TTF URL map (small) — loaded alongside the exporter so the
  // resolver lets the PDF embed the real face for any curated Google Font.
  const { FONT_FILES } = await import(
    "../../components/text-formatting/font-files.data"
  );
  // PdfExporter no longer falls back to an approximate measurer when the
  // browser canvas probe fails — every caller must supply one explicitly.
  // CanvasTextMeasurer owns its own OffscreenCanvas, so we don't have to
  // share the editor's visible ctx (which would be unsafe anyway).
  const blob = await PdfExporter.export(doc, {
    imageFetcher: docsImageFetcher,
    metadata: { title: metadata?.title ?? title, author: metadata?.author },
    measurer: new CanvasTextMeasurer(),
    fontResolver: (family) => FONT_FILES[family],
  });
  downloadBlob(blob, safeFilename(title, "pdf"));
}
