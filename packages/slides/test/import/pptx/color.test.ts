// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { parseXml } from '../../../src/import/pptx/xml';
import { parseColorElement, parseColorFromContainer, parseHexInContainer } from '../../../src/import/pptx/color';

function colorEl(xml: string): Element {
  return parseXml(`<root xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">${xml}</root>`).documentElement.firstElementChild!;
}

describe('parseColorElement', () => {
  it('maps srgbClr to a normalized hex sRGB', () => {
    expect(parseColorElement(colorEl(`<a:srgbClr val="058dc7"/>`))).toEqual({
      kind: 'srgb',
      value: '#058DC7',
    });
  });

  it('maps schemeClr aliases to ColorRole keys', () => {
    expect(parseColorElement(colorEl(`<a:schemeClr val="accent1"/>`))).toEqual({
      kind: 'role',
      role: 'accent1',
    });
    expect(parseColorElement(colorEl(`<a:schemeClr val="bg1"/>`))).toEqual({
      kind: 'role',
      role: 'background',
    });
    expect(parseColorElement(colorEl(`<a:schemeClr val="tx2"/>`))).toEqual({
      kind: 'role',
      role: 'textSecondary',
    });
    expect(parseColorElement(colorEl(`<a:schemeClr val="folHlink"/>`))).toEqual({
      kind: 'role',
      role: 'visitedHyperlink',
    });
  });

  it('preserves tint and shade modifiers on role colors', () => {
    expect(
      parseColorElement(colorEl(`<a:schemeClr val="accent2"><a:tint val="50000"/></a:schemeClr>`)),
    ).toEqual({ kind: 'role', role: 'accent2', tint: 50000 });
    expect(
      parseColorElement(colorEl(`<a:schemeClr val="accent2"><a:shade val="25000"/></a:schemeClr>`)),
    ).toEqual({ kind: 'role', role: 'accent2', shade: 25000 });
  });

  it('falls back through sysClr.lastClr and prstClr', () => {
    expect(parseColorElement(colorEl(`<a:sysClr val="windowText" lastClr="2B2B2B"/>`))).toEqual({
      kind: 'srgb',
      value: '#2B2B2B',
    });
    expect(parseColorElement(colorEl(`<a:prstClr val="red"/>`))).toEqual({
      kind: 'srgb',
      value: '#FF0000',
    });
    expect(parseColorElement(colorEl(`<a:prstClr val="someUnknownColor"/>`))).toEqual({
      kind: 'srgb',
      value: '#000000',
    });
  });

  it('returns undefined for unknown scheme tokens', () => {
    // phClr is a placeholder-color reference that has no fixed mapping.
    expect(parseColorElement(colorEl(`<a:schemeClr val="phClr"/>`))).toBeUndefined();
  });

  it('routes schemeClr through clrMap (benchmark bg2/tx2 swap)', () => {
    const clrMap = new Map<string, string>([['bg2', 'dk2'], ['tx2', 'lt2']]);
    // With the swap, slide-level `bg2` resolves to dk2 = textSecondary.
    expect(parseColorElement(colorEl(`<a:schemeClr val="bg2"/>`), clrMap)).toEqual({
      kind: 'role',
      role: 'textSecondary',
    });
    // And `tx2` resolves to lt2 = backgroundAlt.
    expect(parseColorElement(colorEl(`<a:schemeClr val="tx2"/>`), clrMap)).toEqual({
      kind: 'role',
      role: 'backgroundAlt',
    });
    // Identity entries fall through unchanged.
    expect(parseColorElement(colorEl(`<a:schemeClr val="accent1"/>`), clrMap)).toEqual({
      kind: 'role',
      role: 'accent1',
    });
  });
});

describe('parseColorFromContainer', () => {
  it('finds the first color child of a fill container', () => {
    const fill = parseXml(
      `<a:solidFill xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:srgbClr val="ABCDEF"/></a:solidFill>`,
    ).documentElement;
    expect(parseColorFromContainer(fill)).toEqual({ kind: 'srgb', value: '#ABCDEF' });
  });

  it('returns undefined when no color child is present', () => {
    const fill = parseXml(
      `<a:noFill xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"/>`,
    ).documentElement;
    expect(parseColorFromContainer(fill)).toBeUndefined();
  });
});

describe('parseHexInContainer', () => {
  it('returns just the hex string for ColorScheme slot population', () => {
    const slot = parseXml(
      `<a:accent1 xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:srgbClr val="058dc7"/></a:accent1>`,
    ).documentElement;
    expect(parseHexInContainer(slot)).toBe('#058DC7');
  });

  it('falls through sysClr.lastClr then prstClr', () => {
    const a = parseXml(
      `<a:dk1 xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:sysClr val="windowText" lastClr="222222"/></a:dk1>`,
    ).documentElement;
    expect(parseHexInContainer(a)).toBe('#222222');
  });
});
