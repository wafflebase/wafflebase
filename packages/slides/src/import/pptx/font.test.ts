// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { parseXml } from './xml';
import { containsHangul, parsePrimaryTypeface } from './font';

function fontEl(xml: string): Element {
  return parseXml(`<root xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">${xml}</root>`).documentElement.firstElementChild!;
}

describe('parsePrimaryTypeface', () => {
  it('returns the Latin face on majorFont/minorFont containers', () => {
    expect(
      parsePrimaryTypeface(
        fontEl(`<a:majorFont><a:latin typeface="Calibri Light"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont>`),
      ),
    ).toBe('Calibri Light');
  });

  it('returns undefined when typeface is empty string (inherit)', () => {
    expect(
      parsePrimaryTypeface(fontEl(`<a:majorFont><a:latin typeface=""/></a:majorFont>`)),
    ).toBeUndefined();
  });

  it('returns undefined when latin child is missing', () => {
    expect(parsePrimaryTypeface(fontEl(`<a:minorFont/>`))).toBeUndefined();
  });
});

describe('containsHangul', () => {
  it('detects Hangul syllables', () => {
    expect(containsHangul('안녕하세요')).toBe(true);
    expect(containsHangul('hello 안')).toBe(true);
  });

  it('returns false for Latin / CJK Han', () => {
    expect(containsHangul('Hello')).toBe(false);
    expect(containsHangul('中文')).toBe(false);
    expect(containsHangul('')).toBe(false);
  });
});
