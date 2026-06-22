import { describe, it, expect } from 'vitest';
import { scanFontsUsed, PdfFonts } from '../../src/export/pdf-fonts.js';
import type { Document } from '../../src/model/types.js';
import { DEFAULT_BLOCK_STYLE, generateBlockId } from '../../src/model/types.js';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TEST_FONT = fs.readFileSync(
  path.resolve(__dirname, 'fixtures/fonts/test-cjk.ttf'),
);

const para = (text: string, style: any = {}, fontFamily?: string): Document => ({
  blocks: [{
    id: generateBlockId(),
    type: 'paragraph',
    inlines: [{ text, style: { ...style, ...(fontFamily && { fontFamily }) } }],
    style: { ...DEFAULT_BLOCK_STYLE },
  }],
});

describe('scanFontsUsed', () => {
  it('detects no Korean for ASCII-only document', () => {
    const result = scanFontsUsed(para('Hello World'));
    expect(result.needsKR).toBe(false);
    expect(result.needsKRSerif).toBe(false);
  });

  it('detects Korean sans for hangul text', () => {
    const result = scanFontsUsed(para('안녕하세요'));
    expect(result.needsKR).toBe(true);
    expect(result.needsKRSerif).toBe(false);
  });

  it('detects Korean serif when fontFamily is a serif Korean face', () => {
    const result = scanFontsUsed(para('안녕', {}, '바탕'));
    expect(result.needsKRSerif).toBe(true);
  });

  it('detects bold variant when bold is used', () => {
    const result = scanFontsUsed(para('Hi', { bold: true }));
    expect(result.needsBold).toBe(true);
  });

  const resolver = (family: string) =>
    family === 'Roboto'
      ? { regular: 'https://x/roboto-regular.ttf', bold: 'https://x/roboto-bold.ttf' }
      : family === 'Lobster'
        ? { regular: 'https://x/lobster.ttf' }
        : undefined;

  it('records a curated custom family used on Latin text', () => {
    const result = scanFontsUsed(para('Hello', {}, 'Roboto'), resolver);
    expect(result.customFamilies.get('Roboto')).toEqual({
      needsBold: false,
      regular: 'https://x/roboto-regular.ttf',
      bold: 'https://x/roboto-bold.ttf',
    });
  });

  it('merges needsBold across inlines of the same family', () => {
    const doc: Document = {
      blocks: [{
        id: generateBlockId(),
        type: 'paragraph',
        inlines: [
          { text: 'plain', style: { fontFamily: 'Roboto' } },
          { text: 'strong', style: { fontFamily: 'Roboto', bold: true } },
        ],
        style: { ...DEFAULT_BLOCK_STYLE },
      }],
    };
    expect(scanFontsUsed(doc, resolver).customFamilies.get('Roboto')?.needsBold).toBe(true);
  });

  it('does not record a custom family used only on CJK text (Noto handles it)', () => {
    const result = scanFontsUsed(para('안녕하세요', {}, 'Roboto'), resolver);
    expect(result.customFamilies.has('Roboto')).toBe(false);
  });

  it('ignores families the resolver does not know (system fonts)', () => {
    const result = scanFontsUsed(para('Hello', {}, 'Arial'), resolver);
    expect(result.customFamilies.size).toBe(0);
  });

  it('records nothing when no resolver is supplied', () => {
    const result = scanFontsUsed(para('Hello', {}, 'Roboto'));
    expect(result.customFamilies.size).toBe(0);
  });

  it('walks tables and headers/footers', () => {
    const doc: Document = {
      blocks: [],
      header: { blocks: [{ id: 'h', type: 'paragraph', inlines: [{ text: '한글', style: {} }], style: { ...DEFAULT_BLOCK_STYLE } }], marginFromEdge: 48 },
    };
    const result = scanFontsUsed(doc);
    expect(result.needsKR).toBe(true);
  });
});

describe('PdfFonts', () => {
  it('returns ArrayBuffer from injected sources', async () => {
    const fonts = new PdfFonts({
      sources: { 'kr-sans-regular': () => Promise.resolve(TEST_FONT.buffer as ArrayBuffer) },
    });
    const buf = await fonts.load('kr-sans-regular');
    expect(buf.byteLength).toBe(TEST_FONT.byteLength);
  });

  it('caches a font after first load (no second source call)', async () => {
    let calls = 0;
    const fonts = new PdfFonts({
      sources: {
        'kr-sans-regular': () => { calls++; return Promise.resolve(TEST_FONT.buffer as ArrayBuffer); },
      },
    });
    await fonts.load('kr-sans-regular');
    await fonts.load('kr-sans-regular');
    expect(calls).toBe(1);
  });

  it('loads a custom font key from an injected source', async () => {
    const fonts = new PdfFonts({
      sources: {
        'custom:Roboto:regular': () => Promise.resolve(TEST_FONT.buffer as ArrayBuffer),
      },
    });
    const buf = await fonts.load('custom:Roboto:regular');
    expect(buf.byteLength).toBe(TEST_FONT.byteLength);
  });

  it('throws for an unregistered custom key (no network URL)', async () => {
    const fonts = new PdfFonts({ sources: {} });
    await expect(fonts.load('custom:Nope:regular')).rejects.toThrow(/no source/i);
  });

  it('throws a clear error when source is missing', async () => {
    // Latin sans-regular has no default source (StandardFonts handle it
    // outside PdfFonts.load), so requesting it through PdfFonts directly
    // surfaces the "no source" error path.
    const fonts = new PdfFonts({ sources: {} });
    await expect(fonts.load('sans-regular' as any)).rejects.toThrow(/no source/i);
  });
});
