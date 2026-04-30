// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PDFDocument } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { PdfPainter } from '../../src/export/pdf-painter.js';
import { PdfFonts, type PdfFontKey } from '../../src/export/pdf-fonts.js';
import { computeLayout } from '../../src/view/layout.js';
import { paginateLayout } from '../../src/view/pagination.js';
import {
  DEFAULT_BLOCK_STYLE,
  DEFAULT_PAGE_SETUP,
  generateBlockId,
  getEffectiveDimensions,
} from '../../src/model/types.js';
import type { Document, InlineStyle } from '../../src/model/types.js';

if (typeof Blob.prototype.arrayBuffer !== 'function') {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (Blob.prototype as any).arrayBuffer = function (this: Blob): Promise<ArrayBuffer> {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result as ArrayBuffer);
      r.onerror = () => reject(r.error);
      r.readAsArrayBuffer(this);
    });
  };
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_FONT = fs.readFileSync(
  path.resolve(__dirname, 'fixtures/fonts/test-cjk.ttf'),
).buffer as ArrayBuffer;

const ALL_KEYS: PdfFontKey[] = [
  'sans-regular','sans-bold','sans-italic','sans-boldItalic',
  'serif-regular','serif-bold','serif-italic','serif-boldItalic',
  'kr-sans-regular','kr-sans-bold',
  'kr-serif-regular','kr-serif-bold',
];

function fontsForTest(): PdfFonts {
  const sources: Partial<Record<PdfFontKey, () => Promise<ArrayBuffer>>> = {};
  for (const k of ALL_KEYS) sources[k] = () => Promise.resolve(TEST_FONT);
  return new PdfFonts({ sources });
}

function mockCtx(): CanvasRenderingContext2D {
  return {
    font: '',
    measureText: (text: string) => ({ width: text.length * 8 }),
  } as unknown as CanvasRenderingContext2D;
}

describe('PdfPainter', () => {
  it('paints a simple paragraph onto a PDF page', async () => {
    const pdfDoc = await PDFDocument.create();
    pdfDoc.registerFontkit(fontkit);

    const fonts = await PdfPainter.embedAllFonts(pdfDoc, fontsForTest());

    const doc: Document = {
      blocks: [{
        id: generateBlockId(),
        type: 'paragraph',
        inlines: [{ text: 'Hello', style: {} }],
        style: { ...DEFAULT_BLOCK_STYLE },
      }],
      pageSetup: { ...DEFAULT_PAGE_SETUP },
    };

    const pageSetup = doc.pageSetup!;
    const { width: effectiveWidth } = getEffectiveDimensions(pageSetup);
    const contentWidth =
      effectiveWidth - pageSetup.margins.left - pageSetup.margins.right;

    const { layout } = computeLayout(doc.blocks, mockCtx(), contentWidth);
    const pagination = paginateLayout(layout, pageSetup);
    const lp = pagination.pages[0];
    const page = pdfDoc.addPage([
      (lp.width / 96) * 72,
      (lp.height / 96) * 72,
    ]);

    PdfPainter.paintPage(page, lp, pagination.pageSetup, fonts, {
      doc,
      imageMap: new Map(),
    });

    const bytes = await pdfDoc.save();
    const reloaded = await PDFDocument.load(bytes);
    expect(reloaded.getPageCount()).toBe(1);
  });
});

async function renderWithStyle(style: InlineStyle): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
  pdfDoc.registerFontkit(fontkit);

  const fonts = await PdfPainter.embedAllFonts(pdfDoc, fontsForTest());

  const doc: Document = {
    blocks: [{
      id: generateBlockId(),
      type: 'paragraph',
      inlines: [{ text: 'Sample', style }],
      style: { ...DEFAULT_BLOCK_STYLE },
    }],
    pageSetup: { ...DEFAULT_PAGE_SETUP },
  };

  const pageSetup = doc.pageSetup!;
  const { width: effectiveWidth } = getEffectiveDimensions(pageSetup);
  const contentWidth =
    effectiveWidth - pageSetup.margins.left - pageSetup.margins.right;

  const { layout } = computeLayout(doc.blocks, mockCtx(), contentWidth);
  const pagination = paginateLayout(layout, pageSetup);
  const lp = pagination.pages[0];
  const page = pdfDoc.addPage([
    (lp.width / 96) * 72,
    (lp.height / 96) * 72,
  ]);

  PdfPainter.paintPage(page, lp, pagination.pageSetup, fonts, {
    doc,
    imageMap: new Map(),
  });

  return await pdfDoc.save();
}

describe('PdfPainter inline styles', () => {
  it('draws underline below baseline for underlined runs', async () => {
    const plain = await renderWithStyle({});
    const styled = await renderWithStyle({ underline: true });
    expect(styled.byteLength).toBeGreaterThan(plain.byteLength);
  });

  it('draws background rectangle for backgroundColor runs', async () => {
    const plain = await renderWithStyle({});
    const styled = await renderWithStyle({ backgroundColor: '#FFFF00' });
    expect(styled.byteLength).toBeGreaterThan(plain.byteLength);
  });

  it('draws strike line for strikethrough runs', async () => {
    const plain = await renderWithStyle({});
    const styled = await renderWithStyle({ strikethrough: true });
    expect(styled.byteLength).toBeGreaterThan(plain.byteLength);
  });

  it('renders superscript with smaller size and y-offset', async () => {
    const plain = await renderWithStyle({});
    const sup = await renderWithStyle({ superscript: true });
    expect(sup).not.toEqual(plain);
  });

  it('renders subscript with smaller size and y-offset', async () => {
    const plain = await renderWithStyle({});
    const sub = await renderWithStyle({ subscript: true });
    expect(sub).not.toEqual(plain);
  });
});
