// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { parseXml } from '../../../src/import/pptx/xml';
import { parsePrimaryTypeface } from '../../../src/import/pptx/font';

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

