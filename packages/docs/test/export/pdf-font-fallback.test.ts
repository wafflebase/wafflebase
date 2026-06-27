// @vitest-environment jsdom
//
// Regression coverage for the WinAnsi font-fallback throw bug: a handful
// of characters were classified "Latin-safe" (routed to pdf-lib's
// StandardFonts) that WinAnsi cannot actually encode, so `drawText` /
// `widthOfTextAtSize` threw and aborted the entire export.
//
//   - U+0080-U+009F (C1 controls): inside the U+0000-U+00FF "safe" range
//     but only C0 controls were stripped, so a pasted C1 byte reached
//     Helvetica and threw.
//   - U+201B (reversed-9 quote): the U+2018-U+201E "specials" range
//     wrongly included it; CP1252 has no U+201B, so Helvetica/Times threw.
//
// C1 controls are built with String.fromCharCode so no invisible bytes
// live in the source; U+201B is referenced as ‛ for the same reason.
import { describe, it, expect, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PDFDocument, type PDFFont } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { splitMixedScript } from '../../src/export/pdf-style-map.js';
import { scanFontsUsed } from '../../src/export/pdf-fonts.js';
import { PdfExporter } from '../../src/export/pdf-exporter.js';
import { PdfFonts, type PdfFontKey } from '../../src/export/pdf-fonts.js';
import { PdfPainter, type EmbeddedFonts } from '../../src/export/pdf-painter.js';
import { computeLayout } from '../../src/view/layout.js';
import { paginateLayout } from '../../src/view/pagination.js';
import {
  DEFAULT_BLOCK_STYLE,
  DEFAULT_PAGE_SETUP,
  generateBlockId,
  getEffectiveDimensions,
} from '../../src/model/types.js';
import type { Document } from '../../src/model/types.js';
import { stubMeasurer } from '../view/_stub-measurer.js';

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
  'sans-regular', 'sans-bold', 'sans-italic', 'sans-boldItalic',
  'serif-regular', 'serif-bold', 'serif-italic', 'serif-boldItalic',
  'kr-sans-regular', 'kr-sans-bold',
  'kr-serif-regular', 'kr-serif-bold',
];

function fontsForTest(): PdfFonts {
  const sources: Partial<Record<PdfFontKey, () => Promise<ArrayBuffer>>> = {};
  for (const k of ALL_KEYS) sources[k] = () => Promise.resolve(TEST_FONT);
  return new PdfFonts({ sources });
}

// Representative C1 controls: U+0090 (DCS) and U+0085 (NEL).
const C1_A = String.fromCharCode(0x90);
const C1_B = String.fromCharCode(0x85);
// U+201B — reversed-9 quote, not encodable by CP1252/WinAnsi.
const REV_QUOTE = '‛';

const para = (text: string): Document => ({
  blocks: [{
    id: generateBlockId(),
    type: 'paragraph',
    inlines: [{ text, style: {} }],
    style: { ...DEFAULT_BLOCK_STYLE },
  }],
  pageSetup: { ...DEFAULT_PAGE_SETUP },
});

describe('splitMixedScript — control & misclassified specials', () => {
  it('strips C1 control characters (U+0080-U+009F)', () => {
    // C1 controls are invisible paste artifacts WinAnsi cannot encode.
    // Stripping mirrors the existing C0 handling.
    expect(splitMixedScript(`a${C1_A}b`)).toEqual([
      { text: 'ab', needsCustomFont: false },
    ]);
    expect(splitMixedScript(`${C1_A}${C1_B}`)).toEqual([]);
  });

  it('routes U+201B to the embedded (non-WinAnsi) font', () => {
    // U+201B is not in CP1252; it must not be drawn with a StandardFont.
    expect(splitMixedScript(REV_QUOTE)).toEqual([
      { text: REV_QUOTE, needsCustomFont: true },
    ]);
  });

  it('still treats genuine CP1252 specials as Latin-safe', () => {
    // The neighbours of U+201B in the specials range stay WinAnsi-safe:
    // U+2018, U+2019, U+201A, U+201C, U+201D, U+201E.
    const specials = '‘’‚“”„';
    expect(splitMixedScript(specials)).toEqual([
      { text: specials, needsCustomFont: false },
    ]);
  });
});

describe('scanFontsUsed — misclassified specials trigger KR embed', () => {
  it('requires the Korean font when only non-WinAnsi specials are present', () => {
    // U+201B must route to an embedded font, which means scanFontsUsed has
    // to embed one — otherwise resolveFontKey aliases kr-* back to
    // Helvetica and the draw throws.
    expect(scanFontsUsed(para(REV_QUOTE)).needsKR).toBe(true);
  });

  it('does not pull in the Korean font for C1 controls', () => {
    // scanFontsUsed classifies C1 as Latin-safe (it sits inside the
    // U+0000–U+00FF range), so a stray C1 byte never triggers the heavy
    // KR embed. The actual removal happens later, at paint time.
    expect(scanFontsUsed(para(`a${C1_A}b`)).needsKR).toBe(false);
  });
});

describe('PdfExporter — never throws on misclassified characters', () => {
  const exportText = (text: string) =>
    PdfExporter.export(para(text), {
      fonts: fontsForTest(),
      measurer: stubMeasurer(),
    });

  it('exports a C1 control character without throwing', async () => {
    const blob = await exportText(`Hello${C1_A}World`);
    const reloaded = await PDFDocument.load(new Uint8Array(await blob.arrayBuffer()));
    expect(reloaded.getPageCount()).toBe(1);
  });

  it('exports U+201B without throwing', async () => {
    const blob = await exportText(`quote${REV_QUOTE}here`);
    const reloaded = await PDFDocument.load(new Uint8Array(await blob.arrayBuffer()));
    expect(reloaded.getPageCount()).toBe(1);
  });

  it('exports a mixed Korean/Latin run with a stray special without throwing', async () => {
    const blob = await exportText(`Hello 안녕${REV_QUOTE} World`);
    const reloaded = await PDFDocument.load(new Uint8Array(await blob.arrayBuffer()));
    expect(reloaded.getPageCount()).toBe(1);
  });
});

interface DrawCall {
  text: string;
  font: PDFFont;
}

// Paint a single-paragraph doc and capture every `drawText(text, opts)`
// call with its resolved font. Lets the routing tests assert *which* font
// each segment uses and that no character was silently dropped — the
// no-throw `getPageCount` checks above can't distinguish "rendered" from
// "dropped". Mirrors `collectPaintedText` in pdf-painter.test.ts, but also
// records the font so we can verify the WinAnsi-vs-embedded split.
async function collectDraws(
  text: string,
): Promise<{ draws: DrawCall[]; fonts: EmbeddedFonts }> {
  const pdfDoc = await PDFDocument.create();
  pdfDoc.registerFontkit(fontkit);
  const fonts = await PdfPainter.embedAllFonts(pdfDoc, fontsForTest(), {
    needsKR: true, needsKRSerif: true, needsLatinSerif: true,
    needsBold: true, needsItalic: true, customFamilies: new Map(),
  });

  const doc = para(text);
  const pageSetup = doc.pageSetup!;
  const { width } = getEffectiveDimensions(pageSetup);
  const contentWidth = width - pageSetup.margins.left - pageSetup.margins.right;
  const { layout } = computeLayout(doc.blocks, stubMeasurer(), contentWidth);
  const pagination = paginateLayout(layout, pageSetup);
  const lp = pagination.pages[0];
  const page = pdfDoc.addPage([(lp.width / 96) * 72, (lp.height / 96) * 72]);

  const draws: DrawCall[] = [];
  vi.spyOn(page, 'drawText').mockImplementation((t, opts) => {
    // The painter always passes a font; `options` is optional only in
    // pdf-lib's signature.
    draws.push({ text: t, font: opts?.font as PDFFont });
  });

  PdfPainter.paintPage(page, lp, pagination.pageSetup, fonts, {
    doc, imageMap: new Map(), layoutBlocks: layout.blocks,
  });
  return { draws, fonts };
}

describe('PdfPainter — routing of the fixed characters', () => {
  it('routes U+201B + Korean to the embedded font and keeps Latin on the StandardFont', async () => {
    const { draws, fonts } = await collectDraws(`Hello 안녕${REV_QUOTE} World`);

    // Korean and U+201B are both non-WinAnsi, so they form one contiguous
    // segment drawn with the embedded Korean font — and neither is dropped.
    const krSegment = draws.find((d) => d.text.includes(REV_QUOTE));
    expect(krSegment).toBeDefined();
    expect(krSegment!.text).toContain('안녕');
    expect(krSegment!.font).toBe(fonts['kr-sans-regular']);

    // The Latin segments stay on the WinAnsi StandardFont.
    const latinSegment = draws.find((d) => d.text.includes('Hello'));
    expect(latinSegment?.font).toBe(fonts['sans-regular']);
  });

  it('drops C1 controls entirely — never handed to a font', async () => {
    const { draws } = await collectDraws(`Hello${C1_A}World`);
    const painted = draws.map((d) => d.text).join('');
    expect(painted).not.toContain(C1_A);
    // The surrounding Latin is preserved and re-joined after the strip.
    expect(painted).toContain('HelloWorld');
  });
});
