import { describe, it, expect } from 'vitest';
import { scanFontsUsed } from '../../src/export/pdf-fonts.js';
import type { Document } from '../../src/model/types.js';
import { DEFAULT_BLOCK_STYLE, generateBlockId } from '../../src/model/types.js';

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

  it('walks tables and headers/footers', () => {
    const doc: Document = {
      blocks: [],
      header: { blocks: [{ id: 'h', type: 'paragraph', inlines: [{ text: '한글', style: {} }], style: { ...DEFAULT_BLOCK_STYLE } }], marginFromEdge: 48 },
    };
    const result = scanFontsUsed(doc);
    expect(result.needsKR).toBe(true);
  });
});
