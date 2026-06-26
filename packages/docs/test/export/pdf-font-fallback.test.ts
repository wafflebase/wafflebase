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
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PDFDocument } from 'pdf-lib';
import { splitMixedScript } from '../../src/export/pdf-style-map.js';
import { scanFontsUsed } from '../../src/export/pdf-fonts.js';
import { PdfExporter } from '../../src/export/pdf-exporter.js';
import { PdfFonts, type PdfFontKey } from '../../src/export/pdf-fonts.js';
import {
  DEFAULT_BLOCK_STYLE,
  DEFAULT_PAGE_SETUP,
  generateBlockId,
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

  it('does not require the Korean font for C1 controls (stripped at paint)', () => {
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
