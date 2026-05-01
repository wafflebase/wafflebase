// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PDFDocument, PDFName } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { PdfPainter } from '../../src/export/pdf-painter.js';
import { PdfExporter } from '../../src/export/pdf-exporter.js';
import { PdfFonts, type PdfFontKey } from '../../src/export/pdf-fonts.js';
import { computeLayout } from '../../src/view/layout.js';
import { paginateLayout } from '../../src/view/pagination.js';
import {
  DEFAULT_BLOCK_STYLE,
  DEFAULT_PAGE_SETUP,
  createTableBlock,
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

const testFonts = fontsForTest;

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

async function collectPaintedText(
  doc: Document,
  pageIndex = 0,
): Promise<string[]> {
  const pdfDoc = await PDFDocument.create();
  pdfDoc.registerFontkit(fontkit);

  const fonts = await PdfPainter.embedAllFonts(pdfDoc, fontsForTest(), {
    needsKR: true,
    needsKRSerif: true,
    needsLatinSerif: true,
    needsBold: true,
    needsItalic: true,
  });

  const pageSetup = doc.pageSetup ?? DEFAULT_PAGE_SETUP;
  const { width: effectiveWidth } = getEffectiveDimensions(pageSetup);
  const contentWidth =
    effectiveWidth - pageSetup.margins.left - pageSetup.margins.right;

  const { layout } = computeLayout(doc.blocks, mockCtx(), contentWidth);
  const pagination = paginateLayout(layout, pageSetup);
  const lp = pagination.pages[pageIndex];
  expect(lp).toBeDefined();

  const page = pdfDoc.addPage([
    (lp.width / 96) * 72,
    (lp.height / 96) * 72,
  ]);

  const paintedText: string[] = [];
  const drawTextSpy = vi.spyOn(page, 'drawText').mockImplementation(
    (text) => {
      paintedText.push(text);
    },
  );

  PdfPainter.paintPage(page, lp, pagination.pageSetup, fonts, {
    doc,
    imageMap: new Map(),
    layoutBlocks: layout.blocks,
  });

  drawTextSpy.mockRestore();
  return paintedText;
}

describe('PdfPainter table regressions', () => {
  it('paints text inside nested tables', async () => {
    const innerTable = createTableBlock(1, 1);
    innerTable.tableData!.rows[0].cells[0].blocks[0].inlines = [
      { text: 'Inner nested marker', style: {} },
    ];

    const outerTable = createTableBlock(1, 1);
    outerTable.tableData!.rows[0].cells[0].blocks = [innerTable];

    const doc: Document = {
      blocks: [outerTable],
      pageSetup: { ...DEFAULT_PAGE_SETUP },
    };

    const paintedText = await collectPaintedText(doc);
    expect(paintedText.join('')).toContain('Inner nested marker');
  });

  it('paints normal rows that follow a split row fragment on the same page', async () => {
    const tableBlock = createTableBlock(3, 1);
    const tableData = tableBlock.tableData!;

    const tallCell = tableData.rows[0].cells[0];
    tallCell.blocks = [];
    for (let i = 0; i < 60; i++) {
      tallCell.blocks.push({
        id: `split-row-p${i}`,
        type: 'paragraph',
        inlines: [{ text: `Split row paragraph ${i}`, style: {} }],
        style: { ...DEFAULT_BLOCK_STYLE },
      });
    }

    tableData.rows[1].cells[0].blocks[0].inlines = [
      { text: 'Follow-up row one marker', style: {} },
    ];
    tableData.rows[2].cells[0].blocks[0].inlines = [
      { text: 'Follow-up row two marker', style: {} },
    ];

    const doc: Document = {
      blocks: [tableBlock],
      pageSetup: { ...DEFAULT_PAGE_SETUP },
    };

    const pageSetup = doc.pageSetup!;
    const { width } = getEffectiveDimensions(pageSetup);
    const contentWidth = width - pageSetup.margins.left - pageSetup.margins.right;
    const { layout } = computeLayout(doc.blocks, mockCtx(), contentWidth);
    const pagination = paginateLayout(layout, pageSetup);
    const continuationPageIndex = pagination.pages.findIndex((page) =>
      page.lines.some(
        (pl) => pl.rowSplitOffset !== undefined && pl.rowSplitOffset > 0,
      ),
    );
    expect(continuationPageIndex).toBeGreaterThan(0);

    const paintedText = await collectPaintedText(doc, continuationPageIndex);
    const painted = paintedText.join('');
    expect(painted).toContain('Follow-up row one marker');
    expect(painted).toContain('Follow-up row two marker');
  });
});

async function renderWithStyle(
  style: InlineStyle,
  text: string = 'Sample',
): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
  pdfDoc.registerFontkit(fontkit);

  // Tell embedAllFonts the test text might contain Korean so it
  // embeds the test CJK font for the kr-* keys instead of falling
  // back to Helvetica (which can't encode 한글 / list-marker glyphs).
  const fonts = await PdfPainter.embedAllFonts(pdfDoc, fontsForTest(), {
    needsKR: true,
    needsKRSerif: true,
    needsLatinSerif: true,
    needsBold: true,
    needsItalic: true,
  });

  const doc: Document = {
    blocks: [{
      id: generateBlockId(),
      type: 'paragraph',
      inlines: [{ text, style }],
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

  it('applies oblique transform for italic Korean text', async () => {
    const koreanRegular = await renderWithStyle({}, '안녕');
    const koreanItalic = await renderWithStyle({ italic: true }, '안녕');
    expect(koreanItalic).not.toEqual(koreanRegular);
  });

  it('produces a valid PDF for italic Korean (re-loadable)', async () => {
    const bytes = await renderWithStyle({ italic: true }, '안녕');
    const reloaded = await PDFDocument.load(bytes);
    expect(reloaded.getPageCount()).toBe(1);
  });

  it('emits link annotations for href runs', async () => {
    const pdfDoc = await PDFDocument.create();
    pdfDoc.registerFontkit(fontkit);
    await PdfPainter.embedAllFonts(pdfDoc, fontsForTest());

    const doc: Document = {
      blocks: [{
        id: generateBlockId(),
        type: 'paragraph',
        inlines: [{ text: 'click here', style: { href: 'https://example.com' } }],
        style: { ...DEFAULT_BLOCK_STYLE },
      }],
      pageSetup: { ...DEFAULT_PAGE_SETUP },
    };

    const blob = await PdfExporter.export(doc, { fonts: testFonts() });
    const reloaded = await PDFDocument.load(await blob.arrayBuffer());
    const page = reloaded.getPage(0);
    const annotsRef = page.node.get(PDFName.of('Annots'));
    expect(annotsRef).toBeDefined();
    // pdf-lib auto-creates an empty Annots array on every page, so we
    // additionally assert the page actually has at least one annotation.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const size = (annotsRef as any).size?.() ?? (annotsRef as any).array?.length ?? 0;
    expect(size).toBeGreaterThan(0);
  });
});
