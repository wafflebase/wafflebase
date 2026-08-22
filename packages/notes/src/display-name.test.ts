import { describe, it, expect } from 'vitest';
import { MAX_DISPLAY_NAME_LENGTH, sanitizeDisplayName } from './display-name.js';

describe('sanitizeDisplayName', () => {
  it('passes an ordinary name through unchanged', () => {
    expect(sanitizeDisplayName('Ada Lovelace')).toBe('Ada Lovelace');
  });

  it('reports a non-string as no name at all', () => {
    // A run attribute is whatever some client wrote there.
    expect(sanitizeDisplayName(undefined)).toBeNull();
    expect(sanitizeDisplayName(42)).toBeNull();
    expect(sanitizeDisplayName({ name: 'ann' })).toBeNull();
  });

  it('strips controls, bidi overrides and newlines', () => {
    expect(sanitizeDisplayName('a\u202End\nnb\u200B')).toBe('andnb');
  });

  it('strips invisible characters that are not format characters', () => {
    // `\p{Cc}\p{Cf}` alone misses these: as far as Unicode's general categories
    // go they are letters (Hangul filler) or punctuation (braille blank), so a
    // name can pad itself — or read as another's — without being caught.
    expect(sanitizeDisplayName('a\u3164n\u2800n\u115F\uFFA0')).toBe('ann');
    // U+2028 is Zl, not Cc, and would break a label out of its single line.
    expect(sanitizeDisplayName('an\u2028n')).toBe('ann');
  });

  it('folds exotic spaces to plain ones and trims', () => {
    expect(sanitizeDisplayName('\u3000ann\u2007lee ')).toBe('ann lee');
  });

  it('caps a name at a displayable length', () => {
    expect(sanitizeDisplayName('x'.repeat(500))).toBe(
      'x'.repeat(MAX_DISPLAY_NAME_LENGTH),
    );
  });

  it('reports a name with nothing displayable in it as empty', () => {
    // Callers render this the way they render an anonymous editor, rather than
    // painting a zero-width label.
    expect(sanitizeDisplayName('\u200B\u202E  ')).toBe('');
  });
});
