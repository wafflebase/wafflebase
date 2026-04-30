import { PDFDocument } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import type { Document } from '../model/types.js';
import { DEFAULT_PAGE_SETUP, getEffectiveDimensions } from '../model/types.js';
import { PdfFonts, scanFontsUsed } from './pdf-fonts.js';

const PX_PER_PT = 96 / 72;

export interface PdfExportOptions {
  fonts?: PdfFonts;
  imageFetcher?: (url: string) => Promise<Blob>;
  metadata?: { title?: string; author?: string; subject?: string; keywords?: string[] };
}

export class PdfExporter {
  /**
   * Phase 1 hello-world implementation: embeds a single font and
   * draws the concatenated text of the document's first paragraph
   * onto one page. Phase 2 replaces this with the full layout +
   * paginate + paint pipeline.
   */
  static async export(doc: Document, opts: PdfExportOptions = {}): Promise<Blob> {
    const fonts = opts.fonts ?? new PdfFonts();
    const usage = scanFontsUsed(doc);

    const pdfDoc = await PDFDocument.create();
    pdfDoc.registerFontkit(fontkit);

    const fontKey = usage.needsKR ? 'kr-sans-regular' : 'sans-regular';
    const fontBuf = await fonts.load(fontKey);
    // Wrap as Uint8Array so pdf-lib's `instanceof` check passes regardless of
    // which realm the underlying ArrayBuffer originated from (jsdom vs Node).
    const embedded = await pdfDoc.embedFont(new Uint8Array(fontBuf), { subset: true });

    const setup = doc.pageSetup ?? DEFAULT_PAGE_SETUP;
    const { width: wPx, height: hPx } = getEffectiveDimensions(setup);
    const pageWidth = wPx / PX_PER_PT;
    const pageHeight = hPx / PX_PER_PT;
    const page = pdfDoc.addPage([pageWidth, pageHeight]);

    const text = doc.blocks[0]?.inlines.map((i) => i.text).join('') ?? '';
    const fontSize = 12;
    page.drawText(text, {
      x: setup.margins.left / PX_PER_PT,
      y: pageHeight - setup.margins.top / PX_PER_PT - fontSize,
      size: fontSize,
      font: embedded,
    });

    const bytes = await pdfDoc.save();
    // pdf-lib types `bytes` as `Uint8Array<ArrayBufferLike>` which the lib DOM
    // typings refuse to accept as a BlobPart. Cast to a concrete view.
    return new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'application/pdf' });
  }
}
