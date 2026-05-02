import {
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFNumber,
  type PDFObject,
  type PDFRef,
} from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import type { Document } from '../model/types.js';
import { DEFAULT_PAGE_SETUP, getEffectiveDimensions } from '../model/types.js';
import { PdfFonts, scanFontsUsed, type FontUsage } from './pdf-fonts.js';
import { computeLayout, computeListCounters } from '../view/layout.js';
import { paginateLayout } from '../view/pagination.js';
import { CanvasTextMeasurer } from '../view/canvas-measurer.js';
import type { TextMeasurer } from '../view/measurer.js';
import { PdfPainter } from './pdf-painter.js';
import {
  collectAndEmbedImages,
  type ImageFetcher,
} from './pdf-image-painter.js';

const PX_PER_PT = 96 / 72;

export interface PdfExportOptions {
  fonts?: PdfFonts;
  imageFetcher?: ImageFetcher;
  metadata?: { title?: string; author?: string; subject?: string; keywords?: string[] };
  /**
   * Override the text measurer used for layout. The default uses a
   * `CanvasTextMeasurer` in the browser and a deterministic 8-px-per-
   * char fallback in environments without DOM Canvas (jsdom unit tests,
   * Node CLI). The future Docs CLI passes its own `fontkit`-backed
   * measurer here.
   */
  measurer?: TextMeasurer;
}

export class PdfExporter {
  /**
   * Export a `Document` to a PDF blob using the full layout +
   * paginate + paint pipeline. Images are stubbed out for now;
   * Phase 5 wires `collectAndEmbedImages` in.
   */
  static async export(doc: Document, opts: PdfExportOptions = {}): Promise<Blob> {
    const fonts = opts.fonts ?? new PdfFonts();
    const usage = scanFontsUsed(doc);

    // 1. Pre-load Noto KR into document.fonts so Canvas measureText is consistent.
    await ensureCanvasFontsLoaded(usage);

    // 2. Compute layout. The measurer may be supplied by the caller
    // (CLI passes a fontkit-backed one); otherwise fall back to the
    // browser default Canvas measurer or an 8-px-per-char approximation
    // when neither is available (jsdom unit tests).
    const setup = doc.pageSetup ?? DEFAULT_PAGE_SETUP;
    const { width: wPx } = getEffectiveDimensions(setup);
    const contentWidth = wPx - setup.margins.left - setup.margins.right;
    const measurer = opts.measurer ?? defaultMeasurer();
    const { layout } = computeLayout(doc.blocks, measurer, contentWidth);
    const pagination = paginateLayout(layout, setup);

    // Header/footer block lists are independent of body pagination —
    // their layout is computed once here and reused by every page so
    // headers/footers appear identically across the document (with only
    // `pageNumber` substituted per page in the painter).
    const headerLayout = doc.header && doc.header.blocks.length > 0
      ? computeLayout(doc.header.blocks, measurer, contentWidth).layout
      : null;
    const footerLayout = doc.footer && doc.footer.blocks.length > 0
      ? computeLayout(doc.footer.blocks, measurer, contentWidth).layout
      : null;

    // 3. Ordered list counters: computed once over the body block list
    // so every page sees the same item numbers regardless of where the
    // block falls in pagination.
    const listCounters = computeListCounters(doc.blocks);

    // 4. PDF setup. `updateMetadata: false` keeps pdf-lib from
    // overwriting Producer/Creator with its own default during save().
    const pdfDoc = await PDFDocument.create({ updateMetadata: false });
    pdfDoc.registerFontkit(fontkit);

    // Set metadata
    if (opts.metadata?.title) pdfDoc.setTitle(opts.metadata.title);
    if (opts.metadata?.author) pdfDoc.setAuthor(opts.metadata.author);
    if (opts.metadata?.subject) pdfDoc.setSubject(opts.metadata.subject);
    if (opts.metadata?.keywords) pdfDoc.setKeywords(opts.metadata.keywords);
    pdfDoc.setCreationDate(new Date());
    pdfDoc.setModificationDate(new Date());
    pdfDoc.setProducer('Wafflebase Docs');
    pdfDoc.setCreator('Wafflebase Docs');

    const embeddedFonts = await PdfPainter.embedAllFonts(pdfDoc, fonts, usage);

    // 5. Image fetch + embed. Walks the body, header, and footer block
    // lists for image inlines, fetches each unique src via the caller-
    // supplied fetcher, and embeds them into the PDF up-front so the
    // painter can look them up by src in O(1) per draw.
    const imageMap = await collectAndEmbedImages(
      doc, pdfDoc, opts.imageFetcher,
    );

    // 6. Per-page paint. While painting we also build a mapping from
    // body block id → page index (the first page on which the block
    // appears) so the outline tree can later resolve heading targets.
    const blockIdToPage = new Map<string, number>();
    for (let i = 0; i < pagination.pages.length; i++) {
      const lp = pagination.pages[i];
      const pageWidthPt = lp.width / PX_PER_PT;
      const pageHeightPt = lp.height / PX_PER_PT;
      const page = pdfDoc.addPage([pageWidthPt, pageHeightPt]);
      PdfPainter.paintPage(page, lp, pagination.pageSetup, embeddedFonts, {
        doc,
        imageMap,
        pageNumber: i + 1,
        headerLayout,
        footerLayout,
        listCounters,
        layoutBlocks: layout.blocks,
      });

      for (const pl of lp.lines) {
        const block = layout.blocks[pl.blockIndex]?.block;
        if (block && !blockIdToPage.has(block.id)) {
          blockIdToPage.set(block.id, i);
        }
      }
    }

    // 7. Outline tree. Built after all pages exist so getPage(i) works.
    addOutlineFromHeadings(pdfDoc, doc, blockIdToPage);

    const bytes = await pdfDoc.save();
    // pdf-lib types `bytes` as `Uint8Array<ArrayBufferLike>` which the lib DOM
    // typings refuse to accept as a BlobPart. Cast to a concrete view.
    return new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'application/pdf' });
  }
}

/**
 * Build a flat PDF outline (bookmark) tree from heading blocks.
 *
 * Phase 1: every heading is a sibling of the root regardless of
 * `headingLevel` — nesting by level is a follow-up. Each item links
 * to the first page on which the heading appears via a `[page /Fit]`
 * destination array.
 *
 * The outline tree is a doubly-linked list of `/Outlines` items where
 * each item carries `Title`, `Parent`, `Dest`, optional `Prev`/`Next`,
 * and the root carries `First`/`Last`/`Count`. We allocate refs up
 * front via `ctx.nextRef()` so siblings can reference each other
 * before they are written, then `ctx.assign()` the dictionaries.
 */
function addOutlineFromHeadings(
  pdfDoc: PDFDocument,
  doc: Document,
  blockIdToPage: Map<string, number>,
): void {
  const headings = doc.blocks
    .filter(b => b.type === 'heading')
    .map(b => ({
      title: b.inlines.map(i => i.text).join(''),
      level: b.headingLevel ?? 1,
      page: blockIdToPage.get(b.id) ?? 0,
    }))
    .filter(h => h.title.trim().length > 0);

  if (headings.length === 0) return;

  const ctx = pdfDoc.context;
  const outlinesRef = ctx.nextRef();
  const itemRefs = headings.map(() => ctx.nextRef());

  for (let i = 0; i < headings.length; i++) {
    const h = headings[i];
    const pageRef = pdfDoc.getPage(h.page).ref;
    const dest = ctx.obj([pageRef, PDFName.of('Fit')]);
    // PDFHexString.fromText handles non-ASCII safely (UTF-16 BE w/ BOM).
    const itemDict: { [name: string]: PDFObject | PDFRef } = {
      Title: PDFHexString.fromText(h.title),
      Parent: outlinesRef,
      Dest: dest,
    };
    if (i > 0) itemDict.Prev = itemRefs[i - 1];
    if (i < headings.length - 1) itemDict.Next = itemRefs[i + 1];
    ctx.assign(itemRefs[i], ctx.obj(itemDict));
  }

  const outlinesDict = ctx.obj({
    Type: PDFName.of('Outlines'),
    First: itemRefs[0],
    Last: itemRefs[itemRefs.length - 1],
    Count: PDFNumber.of(headings.length),
  });
  ctx.assign(outlinesRef, outlinesDict);
  pdfDoc.catalog.set(PDFName.of('Outlines'), outlinesRef);
}

async function ensureCanvasFontsLoaded(usage: FontUsage): Promise<void> {
  if (typeof document === 'undefined' || !document.fonts) return;
  const families: string[] = [];
  if (usage.needsKR) families.push('Noto Sans KR');
  if (usage.needsKRSerif) families.push('Noto Serif KR');
  await Promise.all(families.map(f =>
    document.fonts.load(`12px "${f}"`).catch(() => {/* ignore */}),
  ));
}

/**
 * Pick a measurer when the caller did not supply one. Tries
 * `CanvasTextMeasurer` first (real browsers); falls back to the
 * 8-px-per-char approximation used by the unit tests when no DOM
 * Canvas is available. A real-browser path that fails the probe
 * warns rather than silently producing a wrong-looking PDF.
 */
function defaultMeasurer(): TextMeasurer {
  const inBrowser = typeof document !== 'undefined';
  if (inBrowser) {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (ctx && typeof ctx.measureText === 'function') {
      try {
        const probe = ctx.measureText('M');
        if (probe && typeof probe.width === 'number' && probe.width > 0) {
          return new CanvasTextMeasurer(ctx);
        }
      } catch { /* fall through to mock */ }
    }
    // We're in a real browser but the canvas probe failed — likely a
    // font-loading race or a browser bug. Falling back to the 8-px-per-
    // char mock would silently produce a PDF with wrong line breaks
    // and text positions, so warn the developer instead of failing
    // quietly. (Tests run in jsdom, where this branch never fires.)
    // eslint-disable-next-line no-console
    console.warn(
      '[PdfExporter] Canvas measureText probe returned 0 in a browser context; ' +
        'falling back to approximate metrics. Resulting PDF layout will not match on-screen pagination.',
    );
  }
  // jsdom / Node fallback: 8 px per char.
  return {
    measureWidth: (text: string) => text.length * 8,
  };
}
