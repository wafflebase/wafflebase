import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { Buffer } from 'node:buffer';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FontkitMeasurer } from '../src/docs/fontkit-measurer.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FONT_PATH = resolve(
  __dirname,
  '../../docs/test/export/fixtures/fonts/test-cjk.ttf',
);
const FONT_BYTES = readFileSync(FONT_PATH);

describe('FontkitMeasurer', () => {
  it('measures Latin text width using font metrics', () => {
    const m = new FontkitMeasurer();
    m.register('NotoSansKR', 'normal', 'normal', FONT_BYTES);

    const w = m.measureWidth('Hello', {
      family: 'NotoSansKR',
      size: 12,
      weight: 'normal',
      style: 'normal',
    });
    // From the test font: 'Hello' = 2456 units / 1000 unitsPerEm * 12 = 29.472
    expect(w).toBeCloseTo(29.472, 2);
  });

  it('measures CJK text via shaping', () => {
    const m = new FontkitMeasurer();
    m.register('NotoSansKR', 'normal', 'normal', FONT_BYTES);

    const w = m.measureWidth('한글', {
      family: 'NotoSansKR',
      size: 16,
      weight: 'normal',
      style: 'normal',
    });
    // '한글' = 1920 units / 1000 unitsPerEm * 16 = 30.72
    expect(w).toBeCloseTo(30.72, 2);
  });

  it('returns 0 for empty text', () => {
    const m = new FontkitMeasurer();
    m.register('Helvetica', 'normal', 'normal', FONT_BYTES);

    expect(
      m.measureWidth('', {
        family: 'Helvetica',
        size: 14,
        weight: 'normal',
        style: 'normal',
      }),
    ).toBe(0);
  });

  it('looks up fonts case-insensitively on family name', () => {
    const m = new FontkitMeasurer();
    m.register('Helvetica', 'normal', 'normal', FONT_BYTES);

    expect(m.has('helvetica', 'normal', 'normal')).toBe(true);
    expect(m.has('HELVETICA', 'normal', 'normal')).toBe(true);
  });

  it('falls back to em-width estimate when variant is unregistered', () => {
    const m = new FontkitMeasurer({ fallbackEmWidth: 0.5 });
    // Note: register a different variant to confirm we don't accidentally
    // share fonts across (weight, style).
    m.register('NotoSansKR', 'normal', 'normal', FONT_BYTES);

    const w = m.measureWidth('Hello', {
      family: 'NotoSansKR',
      size: 12,
      weight: 'bold',
      style: 'normal',
    });
    expect(w).toBe(5 * 0.5 * 12); // 5 chars × 0.5em × 12px = 30
    expect(m.has('NotoSansKR', 'bold', 'normal')).toBe(false);
  });

  it('keeps separate cache entries for distinct (weight, style) variants', () => {
    const m = new FontkitMeasurer();
    m.register('NotoSansKR', 'normal', 'normal', FONT_BYTES);
    m.register('NotoSansKR', 'bold', 'italic', FONT_BYTES);

    expect(m.has('NotoSansKR', 'normal', 'normal')).toBe(true);
    expect(m.has('NotoSansKR', 'bold', 'italic')).toBe(true);
    expect(m.has('NotoSansKR', 'normal', 'italic')).toBe(false);
  });

  it('rejects TrueType collections (.ttc) — caller must split first', () => {
    // Synthesize a minimal valid `.ttc` header so fontkit's `create`
    // returns a `FontCollection` (the branch we want to exercise) rather
    // than crashing on malformed bytes. TTC layout: 4-byte `'ttcf'`
    // magic, 4-byte version (0x00010000), 4-byte numFonts (1), then one
    // 4-byte offset pointing at a real embedded TTF — we reuse the
    // bundled test font as the inner table data.
    const header = Buffer.alloc(16);
    header.write('ttcf', 0, 'ascii');
    header.writeUInt32BE(0x00010000, 4); // version 1.0
    header.writeUInt32BE(1, 8); // numFonts
    header.writeUInt32BE(16, 12); // offset = sizeof(header)
    const ttc = Buffer.concat([header, FONT_BYTES]);

    const m = new FontkitMeasurer();
    expect(() => m.register('NotoSansKR', 'normal', 'normal', ttc)).toThrow(
      /TrueType collections \(\.ttc\)/,
    );
  });
});
