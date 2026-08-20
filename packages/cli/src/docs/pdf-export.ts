import { PDFDocument } from 'pdf-lib';
import {
  PdfExporter,
  PdfFonts,
  scanFontsUsed,
  type Document,
  type DocxImageFetcher,
  type FontUsage,
  type PdfFontKey,
  type PdfFontsOptions,
  type ResolvedFont,
} from '@wafflebase/docs';
import { FontkitMeasurer } from './fontkit-measurer.js';
import { fetchOrThrow, httpError, redactUrl } from '../errors.js';
import type { PageRange } from './page-range.js';

/**
 * Wrap a transport so the font downloads `PdfFonts` performs on its own
 * obey the CLI's exit contract.
 *
 * `PdfFonts` is shared with the browser, where the CLI's error classes
 * do not exist, so the classification is injected here rather than
 * baked into the engine package. A font CDN that cannot be reached, or
 * that answers 5xx, is a system error like every other network
 * dependency the CLI has — exit `2`, not "you typed something wrong".
 */
export function classifiedFontFetch(
  impl: typeof globalThis.fetch = globalThis.fetch,
): typeof globalThis.fetch {
  return async (input, init) => {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    const res = await fetchOrThrow(url, init, impl);
    if (!res.ok) {
      throw httpError(
        res.status,
        `Font download failed: ${res.status} ${res.statusText} for ${redactUrl(url)}`,
      );
    }
    return res;
  };
}

/**
 * Options for the CLI PDF export pipeline.
 *
 * `pages` is the resolved selection from `parsePageRange`; when present
 * we render the full PDF first and then strip non-selected pages via
 * `pdf-lib` (cheaper than re-implementing a partial paint path inside
 * `PdfExporter`). The future plan is to push a `pageIndices` option
 * down into `PdfExporter` itself; for now the post-process is correct
 * but pays for layout/paint work it then throws away.
 *
 * `fontSources` lets tests inject in-memory buffers via `PdfFonts` so
 * `exportPdf` can run without hitting jsdelivr.
 */
export interface CliPdfExportOptions {
  pages?: PageRange;
  /** Currently informational — `PdfExporter` always paints
   *  header/footer when `doc.header`/`doc.footer` are present. The CLI
   *  surfaces the flag for parity with `docs export --include-header-footer`
   *  and to leave room for a future "strip header/footer" mode. */
  includeHeaderFooter?: boolean;
  fontSources?: PdfFontsOptions['sources'];
  /** Transport for font downloads — a seam for tests. It is always
   *  wrapped in `classifiedFontFetch`, which puts font downloads under
   *  the same exit-code contract as every other CLI request, so a stub
   *  cannot accidentally test around the classification. */
  fontFetch?: typeof globalThis.fetch;
  /** Resolve and download image inlines so they can be embedded in the
   *  PDF. Required when the document contains image inlines —
   *  `PdfExporter` throws otherwise to avoid silently dropping content.
   *  The CLI command builds one via `createImageFetcher` from the
   *  configured server base; tests inject a stub that returns
   *  in-memory bytes. Typed as `DocxImageFetcher` (a structural
   *  `(url) => Promise<Blob>` alias) since the bare `ImageFetcher`
   *  symbol from `pdf-image-painter` isn't re-exported. */
  imageFetcher?: DocxImageFetcher;
}

/**
 * Render `doc` to a PDF byte buffer using the same `PdfExporter` the
 * editor uses, with a `fontkit`-backed measurer in place of the browser
 * Canvas measurer. Korean fonts referenced by the document are
 * pre-loaded through `PdfFonts` and registered with the measurer so
 * pagination matches what the painter then draws.
 *
 * Latin text falls back to the measurer's coarse 0.5em estimate
 * (Helvetica/Times metrics aren't bundled). Pure-ASCII docs may
 * therefore line-break differently in the CLI than in the browser; the
 * paint output stays correct because `PdfPainter` uses pdf-lib's
 * StandardFonts at draw time.
 */
export async function exportPdf(
  doc: Document,
  opts: CliPdfExportOptions = {},
): Promise<Uint8Array> {
  const usage = scanFontsUsed(doc);
  const fonts = new PdfFonts({
    sources: opts.fontSources,
    fetchImpl: classifiedFontFetch(opts.fontFetch),
  });
  const measurer = new FontkitMeasurer();
  await preloadKoreanFonts(fonts, measurer, usage);

  const blob = await PdfExporter.export(doc, {
    measurer,
    fonts,
    imageFetcher: opts.imageFetcher,
  });
  const fullBytes = new Uint8Array(await blob.arrayBuffer());

  if (!opts.pages || opts.pages.pages.size === 0) {
    return fullBytes;
  }
  return extractPages(fullBytes, opts.pages);
}

/**
 * Load every Korean variant `usage` reports as needed and register each
 * loaded buffer with the measurer under both the canonical `'Noto …'`
 * family name and the editor-side aliases (`바탕`, `Batang`) so inline
 * styles that pick a non-canonical family still hit a real font instead
 * of the fallback estimate.
 */
async function preloadKoreanFonts(
  fonts: PdfFonts,
  measurer: FontkitMeasurer,
  usage: FontUsage,
): Promise<void> {
  const variants: Array<{
    key: PdfFontKey;
    weight: ResolvedFont['weight'];
    families: string[];
  }> = [];
  if (usage.needsKR) {
    variants.push({
      key: 'kr-sans-regular',
      weight: 'normal',
      families: ['Noto Sans KR'],
    });
  }
  if (usage.needsKR && usage.needsBold) {
    variants.push({
      key: 'kr-sans-bold',
      weight: 'bold',
      families: ['Noto Sans KR'],
    });
  }
  if (usage.needsKRSerif) {
    variants.push({
      key: 'kr-serif-regular',
      weight: 'normal',
      families: ['Noto Serif KR', '바탕', 'Batang'],
    });
  }
  if (usage.needsKRSerif && usage.needsBold) {
    variants.push({
      key: 'kr-serif-bold',
      weight: 'bold',
      families: ['Noto Serif KR', '바탕', 'Batang'],
    });
  }

  for (const v of variants) {
    const buf = await fonts.load(v.key);
    for (const family of v.families) {
      measurer.register(family, v.weight, 'normal', buf);
    }
  }
}

/**
 * Keep only the pages named by `range` and return the new PDF bytes.
 *
 * Iterates from the highest index down so each `removePage(idx)` call
 * doesn't shift the indices of pages we haven't visited yet. Pages in
 * `range.pages` are 1-based; pdf-lib indexes from 0.
 */
async function extractPages(
  bytes: Uint8Array,
  range: PageRange,
): Promise<Uint8Array> {
  const pdf = await PDFDocument.load(bytes);
  const total = pdf.getPageCount();
  for (let i = total - 1; i >= 0; i--) {
    const oneBased = i + 1;
    if (!range.pages.has(oneBased)) {
      pdf.removePage(i);
    }
  }
  const out = await pdf.save();
  return out;
}
