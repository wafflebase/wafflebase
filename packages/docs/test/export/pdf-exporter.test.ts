// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PDFDocument } from 'pdf-lib';
import { PdfExporter } from '../../src/export/pdf-exporter.js';
import { PdfFonts, type PdfFontKey } from '../../src/export/pdf-fonts.js';
import { DEFAULT_BLOCK_STYLE, generateBlockId } from '../../src/model/types.js';
import type { Document } from '../../src/model/types.js';

// jsdom Blob shim — older jsdom builds lack arrayBuffer()
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
const TEST_FONT_BUFFER = fs.readFileSync(
  path.resolve(__dirname, 'fixtures/fonts/test-cjk.ttf'),
).buffer as ArrayBuffer;

const ALL_KEYS: PdfFontKey[] = [
  'sans-regular','sans-bold','sans-italic','sans-boldItalic',
  'serif-regular','serif-bold','serif-italic','serif-boldItalic',
  'kr-sans-regular','kr-sans-bold',
  'kr-serif-regular','kr-serif-bold',
];

function testFonts(): PdfFonts {
  const sources: Partial<Record<PdfFontKey, () => Promise<ArrayBuffer>>> = {};
  for (const key of ALL_KEYS) {
    sources[key] = () => Promise.resolve(TEST_FONT_BUFFER);
  }
  return new PdfFonts({ sources });
}

describe('PdfExporter (hello world)', () => {
  it('produces a valid PDF for a single Korean line', async () => {
    const doc: Document = {
      blocks: [{
        id: generateBlockId(),
        type: 'paragraph',
        inlines: [{ text: '안녕하세요', style: {} }],
        style: { ...DEFAULT_BLOCK_STYLE },
      }],
    };

    const blob = await PdfExporter.export(doc, { fonts: testFonts() });
    expect(blob.size).toBeGreaterThan(0);
    expect(blob.type).toBe('application/pdf');

    const pdfDoc = await PDFDocument.load(await blob.arrayBuffer());
    expect(pdfDoc.getPageCount()).toBeGreaterThanOrEqual(1);
  });
});

const simpleFixture = JSON.parse(
  fs.readFileSync(
    path.resolve(__dirname, 'fixtures/pdf/simple-paragraph.json'),
    'utf8',
  ),
) as Document;

const mixedFixture = JSON.parse(
  fs.readFileSync(
    path.resolve(__dirname, 'fixtures/pdf/mixed-korean-english.json'),
    'utf8',
  ),
) as Document;

describe('PdfExporter (full pipeline)', () => {
  it('exports the simple-paragraph fixture', async () => {
    const blob = await PdfExporter.export(simpleFixture, { fonts: testFonts() });
    const pdfDoc = await PDFDocument.load(await blob.arrayBuffer());
    expect(pdfDoc.getPageCount()).toBe(1);
    const pages = pdfDoc.getPages();
    expect(pages[0].getWidth()).toBeGreaterThan(0);
  });

  it('exports the mixed-korean-english fixture', async () => {
    const blob = await PdfExporter.export(mixedFixture, { fonts: testFonts() });
    const pdfDoc = await PDFDocument.load(await blob.arrayBuffer());
    expect(pdfDoc.getPageCount()).toBe(1);
    expect(blob.size).toBeGreaterThan(1000);
  });
});
