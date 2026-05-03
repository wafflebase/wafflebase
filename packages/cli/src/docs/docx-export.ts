import {
  DocxExporter,
  type Document,
  type ImageFetcher,
} from '@wafflebase/docs';

export interface CliDocxExportOptions {
  /** Mirrors `--include-header-footer`; informational only — DOCX always
   *  emits the document's `header` / `footer` regions when they exist. */
  includeHeaderFooter?: boolean;
  /** Test seam: provide a stub image fetcher so `exportDocx` doesn't
   *  reach out to the network for image inlines. */
  imageFetcher?: ImageFetcher;
}

/**
 * Render `doc` to a `.docx` byte buffer via the shared `DocxExporter`.
 *
 * `--pages` is intentionally not handled here — the design (§5.2) says
 * the docx path warns and ignores it; the CLI command emits that
 * warning before calling this function so the helper itself stays a
 * pure renderer. Throws if the document contains image inlines and no
 * `imageFetcher` is supplied (matching `DocxExporter.export` behavior).
 */
export async function exportDocx(
  doc: Document,
  opts: CliDocxExportOptions = {},
): Promise<Uint8Array> {
  const blob = await DocxExporter.export(doc, opts.imageFetcher);
  return new Uint8Array(await blob.arrayBuffer());
}
