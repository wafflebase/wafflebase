import { PDFDocument } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import type { Document } from '../model/types.js';
import { DEFAULT_PAGE_SETUP, getEffectiveDimensions } from '../model/types.js';
import { PdfFonts, scanFontsUsed, type FontUsage } from './pdf-fonts.js';
import { computeLayout, computeListCounters } from '../view/layout.js';
import { paginateLayout } from '../view/pagination.js';
import { PdfPainter } from './pdf-painter.js';

const PX_PER_PT = 96 / 72;

export interface PdfExportOptions {
  fonts?: PdfFonts;
  imageFetcher?: (url: string) => Promise<Blob>;
  metadata?: { title?: string; author?: string; subject?: string; keywords?: string[] };
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

    // 2. Compute layout. Need a CanvasRenderingContext2D for measureText.
    const setup = doc.pageSetup ?? DEFAULT_PAGE_SETUP;
    const { width: wPx } = getEffectiveDimensions(setup);
    const contentWidth = wPx - setup.margins.left - setup.margins.right;
    const ctx = getMeasurementCtx();
    const { layout } = computeLayout(doc.blocks, ctx, contentWidth);
    const pagination = paginateLayout(layout, setup);

    // Header/footer block lists are independent of body pagination —
    // their layout is computed once here and reused by every page so
    // headers/footers appear identically across the document (with only
    // `pageNumber` substituted per page in the painter).
    const headerLayout = doc.header && doc.header.blocks.length > 0
      ? computeLayout(doc.header.blocks, ctx, contentWidth).layout
      : null;
    const footerLayout = doc.footer && doc.footer.blocks.length > 0
      ? computeLayout(doc.footer.blocks, ctx, contentWidth).layout
      : null;

    // 3. Image fetch (Phase 5 — stub for now)
    const imageMap = new Map<string, { embedded: unknown; width: number; height: number }>();

    // Ordered list counters: computed once over the body block list so
    // every page sees the same item numbers regardless of where the
    // block falls in pagination.
    const listCounters = computeListCounters(doc.blocks);

    // 4. PDF setup
    const pdfDoc = await PDFDocument.create();
    pdfDoc.registerFontkit(fontkit);
    const embeddedFonts = await PdfPainter.embedAllFonts(pdfDoc, fonts);

    // 5. Per-page paint
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
      });
    }

    const bytes = await pdfDoc.save();
    // pdf-lib types `bytes` as `Uint8Array<ArrayBufferLike>` which the lib DOM
    // typings refuse to accept as a BlobPart. Cast to a concrete view.
    return new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'application/pdf' });
  }
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
 * In a real browser, returns a canvas 2D context for text measurement.
 * In jsdom (or any env without canvas), returns a minimal mock that
 * approximates measureText using a constant per-char width — good
 * enough for unit tests, NOT for production.
 */
function getMeasurementCtx(): CanvasRenderingContext2D {
  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas');
    const realCtx = canvas.getContext('2d');
    if (realCtx && typeof realCtx.measureText === 'function') {
      try {
        const probe = realCtx.measureText('M');
        if (probe && typeof probe.width === 'number' && probe.width > 0) {
          return realCtx;
        }
      } catch { /* fall through to mock */ }
    }
  }
  // jsdom fallback: 8 px per char
  return {
    measureText: (text: string) => ({ width: text.length * 8 }),
    font: '',
  } as unknown as CanvasRenderingContext2D;
}
