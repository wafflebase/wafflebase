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

const hfFixture = JSON.parse(
  fs.readFileSync(
    path.resolve(__dirname, 'fixtures/pdf/with-header-footer-pagenumber.json'),
    'utf8',
  ),
) as Document;

const listFixture = JSON.parse(
  fs.readFileSync(
    path.resolve(__dirname, 'fixtures/pdf/with-list.json'),
    'utf8',
  ),
) as Document;

const tableFixture = JSON.parse(
  fs.readFileSync(
    path.resolve(__dirname, 'fixtures/pdf/with-table.json'),
    'utf8',
  ),
) as Document;

const mergedFixture = JSON.parse(
  fs.readFileSync(
    path.resolve(__dirname, 'fixtures/pdf/with-merged-cells.json'),
    'utf8',
  ),
) as Document;

const splitRowFixture = JSON.parse(
  fs.readFileSync(
    path.resolve(__dirname, 'fixtures/pdf/with-split-row.json'),
    'utf8',
  ),
) as Document;

const imageFixture = JSON.parse(
  fs.readFileSync(
    path.resolve(__dirname, 'fixtures/pdf/with-image.json'),
    'utf8',
  ),
) as Document;

const TEST_PNG = fs.readFileSync(
  path.resolve(__dirname, 'fixtures/pdf/test-image.png'),
);

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

describe('PdfExporter (multi-page)', () => {
  it('produces multiple pages for long content', async () => {
    const longDoc: Document = {
      blocks: Array.from({ length: 200 }, (_, i) => ({
        id: `p${i}`,
        type: 'paragraph' as const,
        inlines: [{ text: `Paragraph ${i}: lorem ipsum dolor sit amet consectetur adipiscing elit.`, style: {} }],
        style: { ...DEFAULT_BLOCK_STYLE },
      })),
    };
    const blob = await PdfExporter.export(longDoc, { fonts: testFonts() });
    const pdfDoc = await PDFDocument.load(await blob.arrayBuffer());
    expect(pdfDoc.getPageCount()).toBeGreaterThanOrEqual(2);
  });
});

describe('PdfExporter (header/footer/page-number)', () => {
  it('exports the with-header-footer-pagenumber fixture', async () => {
    const blob = await PdfExporter.export(hfFixture, { fonts: testFonts() });
    const pdfDoc = await PDFDocument.load(await blob.arrayBuffer());
    expect(pdfDoc.getPageCount()).toBe(1);
    // Header + footer presence: blob should be larger than a body-only equivalent
    expect(blob.size).toBeGreaterThan(2000);
  });

  it('renders larger PDF for documents with headers/footers vs without', async () => {
    const bodyOnly: Document = {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      blocks: hfFixture.blocks.map(b => ({ ...b, style: { ...b.style } } as any)),
    };
    const a = await PdfExporter.export(bodyOnly, { fonts: testFonts() });
    const b = await PdfExporter.export(hfFixture, { fonts: testFonts() });
    expect(b.size).toBeGreaterThan(a.size);
  });
});

describe('PdfExporter (tables)', () => {
  it('exports a table fixture with backgrounds and borders', async () => {
    const blob = await PdfExporter.export(tableFixture, { fonts: testFonts() });
    const pdfDoc = await PDFDocument.load(await blob.arrayBuffer());
    expect(pdfDoc.getPageCount()).toBe(1);
    expect(blob.size).toBeGreaterThan(2000);
  });

  it('table PDF is larger than equivalent paragraphs (proves chrome was drawn)', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tableBlock = tableFixture.blocks[0] as any;
    const flat: Document = {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      blocks: tableBlock.tableData.rows.flatMap((r: any) =>
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        r.cells.map((c: any) => ({
          ...c.blocks[0],
          id: `flat-${Math.random().toString(36).slice(2, 8)}`,
        })),
      ),
    };
    const flatBlob = await PdfExporter.export(flat, { fonts: testFonts() });
    const tableBlob = await PdfExporter.export(tableFixture, { fonts: testFonts() });
    expect(tableBlob.size).toBeGreaterThan(flatBlob.size);
  });

  it('table cell content text appears in PDF (size delta)', async () => {
    // Same fixture but with empty cell text
    const empty = JSON.parse(JSON.stringify(tableFixture));
    for (const row of empty.blocks[0].tableData.rows) {
      for (const cell of row.cells) {
        cell.blocks = [];
      }
    }
    const emptyBlob = await PdfExporter.export(empty as Document, { fonts: testFonts() });
    const fullBlob = await PdfExporter.export(tableFixture, { fonts: testFonts() });
    expect(fullBlob.size).toBeGreaterThan(emptyBlob.size);
  });
});

describe('PdfExporter (merged cells)', () => {
  it('exports a table with colSpan and rowSpan without erroring', async () => {
    const blob = await PdfExporter.export(mergedFixture, { fonts: testFonts() });
    const pdfDoc = await PDFDocument.load(await blob.arrayBuffer());
    expect(pdfDoc.getPageCount()).toBe(1);
    expect(blob.size).toBeGreaterThan(2000);
  });
});

describe('PdfExporter (row split)', () => {
  it('exports a table with a row that splits across pages', async () => {
    const blob = await PdfExporter.export(splitRowFixture, { fonts: testFonts() });
    const pdfDoc = await PDFDocument.load(await blob.arrayBuffer());
    expect(pdfDoc.getPageCount()).toBeGreaterThanOrEqual(2);
    expect(blob.size).toBeGreaterThan(2000);
  });
});

describe('PdfExporter (images)', () => {
  it('embeds an image inline', async () => {
    let fetchCount = 0;
    const blob = await PdfExporter.export(imageFixture, {
      fonts: testFonts(),
      imageFetcher: async (src: string) => {
        fetchCount++;
        expect(src).toBe('test://image1');
        return new Blob([TEST_PNG], { type: 'image/png' });
      },
    });
    expect(fetchCount).toBe(1);
    const pdfDoc = await PDFDocument.load(await blob.arrayBuffer());
    expect(pdfDoc.getPageCount()).toBe(1);
    expect(blob.size).toBeGreaterThan(TEST_PNG.byteLength);

    // Compare against the same fixture with the image inline stripped:
    // the embedded-image PDF must be meaningfully larger.
    const noImage: Document = {
      blocks: imageFixture.blocks.map(b => ({
        ...b,
        inlines: b.inlines.filter(i => !i.style.image),
      })),
    };
    const noImageBlob = await PdfExporter.export(noImage, {
      fonts: testFonts(),
    });
    expect(blob.size).toBeGreaterThan(noImageBlob.size + 50);
  });

  it('throws when image inline exists but no fetcher provided', async () => {
    await expect(
      PdfExporter.export(imageFixture, { fonts: testFonts() }),
    ).rejects.toThrow(/imageFetcher/i);
  });
});

describe('PdfExporter (list markers)', () => {
  it('exports list items with markers', async () => {
    const blob = await PdfExporter.export(listFixture, { fonts: testFonts() });
    const pdfDoc = await PDFDocument.load(await blob.arrayBuffer());
    expect(pdfDoc.getPageCount()).toBe(1);

    // Equivalent doc with paragraphs (no markers) should yield smaller PDF
    const flatDoc: Document = {
      blocks: listFixture.blocks.map(b => ({
        ...b,
        type: 'paragraph' as const,
        listKind: undefined,
        listLevel: undefined,
      })),
    };
    const flatBlob = await PdfExporter.export(flatDoc, { fonts: testFonts() });
    expect(blob.size).toBeGreaterThan(flatBlob.size);
  });
});

describe('PdfExporter (metadata)', () => {
  it('writes title and author into PDF metadata', async () => {
    const blob = await PdfExporter.export(simpleFixture, {
      fonts: testFonts(),
      metadata: { title: 'My Doc', author: 'Alice' },
    });
    const pdfDoc = await PDFDocument.load(await blob.arrayBuffer());
    expect(pdfDoc.getTitle()).toBe('My Doc');
    expect(pdfDoc.getAuthor()).toBe('Alice');
  });

  it('sets producer/creator when no metadata provided', async () => {
    const blob = await PdfExporter.export(simpleFixture, { fonts: testFonts() });
    // updateMetadata: false prevents pdf-lib from overwriting the Producer
    // field with its own default during the load() call.
    const pdfDoc = await PDFDocument.load(await blob.arrayBuffer(), {
      updateMetadata: false,
    });
    expect(pdfDoc.getProducer()).toMatch(/wafflebase/i);
  });
});
