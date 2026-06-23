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

  const embeddable = new Set(['Roboto']);
  it('returns a custom key for an embedded Google Font on Latin text', () => {
    expect(resolveFontKey({ fontFamily: 'Roboto' } as InlineStyle, false, embeddable))
      .toBe('custom:Roboto:regular');
  });
  it('returns the custom bold key for bold text', () => {
    expect(resolveFontKey({ fontFamily: 'Roboto', bold: true } as InlineStyle, false, embeddable))
      .toBe('custom:Roboto:bold');
  });
  it('uses the custom regular key for italic (oblique is synthesized)', () => {
    expect(resolveFontKey({ fontFamily: 'Roboto', italic: true } as InlineStyle, false, embeddable))
      .toBe('custom:Roboto:regular');
  });
  it('routes CJK segments of a custom family to the Noto path', () => {
    expect(resolveFontKey({ fontFamily: 'Roboto' } as InlineStyle, true, embeddable))
      .toBe('kr-sans-regular');
  });
  it('falls back to standard faces when the family is not embedded', () => {
    expect(resolveFontKey({ fontFamily: 'Lobster' } as InlineStyle, false, embeddable))
      .toBe('sans-regular');
  });
});

describe('splitMixedScript', () => {
  it('returns single segment for ASCII-only', () => {
    const out = splitMixedScript('Hello World');
    expect(out).toEqual([{ text: 'Hello World', needsCustomFont: false }]);
  });
  it('splits at script boundaries', () => {
    const out = splitMixedScript('Hello 안녕 World');
    expect(out).toEqual([
      { text: 'Hello ', needsCustomFont: false },
      { text: '안녕', needsCustomFont: true },
      { text: ' World', needsCustomFont: false },
    ]);
  });
  it('returns empty array for empty input', () => {
    expect(splitMixedScript('')).toEqual([]);
  });
  it('strips C0 control characters (LF, CR, TAB, NUL)', () => {
    // WinAnsi can't encode these and they have no visual rendering.
    // Stripping happens before classification, so a control-only
    // string yields no segments.
    expect(splitMixedScript('\u0000\t\r\n')).toEqual([]);
    expect(splitMixedScript('Hello\nWorld')).toEqual([
      { text: 'HelloWorld', needsCustomFont: false },
    ]);
  });
  it('preserves U+FFFC (Object Replacement Character) for image runs', () => {
    // Image inlines carry U+FFFC as placeholder text. The painter
    // routes image runs before splitMixedScript is called, but the
    // function must NOT strip OBJ as part of "control char cleanup"
    // or width measurements for image-adjacent text would desync.
    // (U+FFFC sits outside LATIN_SAFE_CHARS, so the script splitter
    // separates it from neighboring Latin segments — the contract is
    // preservation, not coalescence.)
    const out = splitMixedScript('a\uFFFCb');
    expect(out.map((s) => s.text).join('')).toBe('a\uFFFCb');
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
  it('shims italic for an embedded custom font (no italic face)', () => {
    const embeddable = new Set(['Roboto']);
    expect(isItalicShim({ italic: true, fontFamily: 'Roboto' } as InlineStyle, false, embeddable))
      .toBe(true);
  });
  it('does not shim a non-embedded family italic', () => {
    const embeddable = new Set(['Roboto']);
    expect(isItalicShim({ italic: true, fontFamily: 'Lobster' } as InlineStyle, false, embeddable))
      .toBe(false);
  });
});
