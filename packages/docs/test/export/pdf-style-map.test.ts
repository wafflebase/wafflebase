import { describe, it, expect } from 'vitest';
import {
  resolveFontKey, splitMixedScript, styleColor, isItalicShim,
} from '../../src/export/pdf-style-map.js';
import type { InlineStyle } from '../../src/model/types.js';

describe('resolveFontKey', () => {
  it('returns sans-regular for default style + Latin', () => {
    expect(resolveFontKey({} as InlineStyle, false)).toBe('sans-regular');
  });
  it('returns kr-sans-bold for bold + Korean run', () => {
    expect(resolveFontKey({ bold: true } as InlineStyle, true)).toBe('kr-sans-bold');
  });
  it('returns sans-italic for italic + Latin', () => {
    expect(resolveFontKey({ italic: true } as InlineStyle, false)).toBe('sans-italic');
  });
  it('returns serif for known serif fontFamily', () => {
    expect(resolveFontKey({ fontFamily: 'Times New Roman' } as InlineStyle, false))
      .toBe('serif-regular');
  });
  it('returns kr-serif-regular for serif Korean', () => {
    expect(resolveFontKey({ fontFamily: '바탕' } as InlineStyle, true))
      .toBe('kr-serif-regular');
  });
});

describe('splitMixedScript', () => {
  it('returns single segment for ASCII-only', () => {
    const out = splitMixedScript('Hello World');
    expect(out).toEqual([{ text: 'Hello World', isCJK: false }]);
  });
  it('splits at script boundaries', () => {
    const out = splitMixedScript('Hello 안녕 World');
    expect(out).toEqual([
      { text: 'Hello ', isCJK: false },
      { text: '안녕', isCJK: true },
      { text: ' World', isCJK: false },
    ]);
  });
  it('returns empty array for empty input', () => {
    expect(splitMixedScript('')).toEqual([]);
  });
});

describe('styleColor', () => {
  it('parses #RRGGBB to {r,g,b} 0..1', () => {
    expect(styleColor('#FF8000')).toEqual({ r: 1, g: 128 / 255, b: 0 });
  });
  it('parses lowercase hex', () => {
    expect(styleColor('#ff8000')).toEqual({ r: 1, g: 128 / 255, b: 0 });
  });
  it('falls back to black for invalid', () => {
    expect(styleColor('not-a-color')).toEqual({ r: 0, g: 0, b: 0 });
  });
  it('returns black for undefined', () => {
    expect(styleColor(undefined)).toEqual({ r: 0, g: 0, b: 0 });
  });
});

describe('isItalicShim', () => {
  it('shims Korean italic (no real italic font)', () => {
    expect(isItalicShim({ italic: true } as InlineStyle, true)).toBe(true);
  });
  it('does not shim Latin italic', () => {
    expect(isItalicShim({ italic: true } as InlineStyle, false)).toBe(false);
  });
  it('returns false when italic is not set', () => {
    expect(isItalicShim({} as InlineStyle, true)).toBe(false);
  });
});
