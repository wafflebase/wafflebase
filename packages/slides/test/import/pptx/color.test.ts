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

  it('normalizes tint and shade modifiers to 0..1 on role colors', () => {
    // OOXML stores `<a:tint val="50000"/>` (50% in thousandths); we
    // normalize at the import boundary so `resolveColor` / `tintColor`
    // can apply the value directly as a 0..1 ratio. Without this
    // normalization, `tintColor(hex, 50000)` saturates to white.
    expect(
      parseColorElement(colorEl(`<a:schemeClr val="accent2"><a:tint val="50000"/></a:schemeClr>`)),
    ).toEqual({ kind: 'role', role: 'accent2', tint: 0.5 });
    expect(
      parseColorElement(colorEl(`<a:schemeClr val="accent2"><a:shade val="25000"/></a:schemeClr>`)),
    ).toEqual({ kind: 'role', role: 'accent2', shade: 0.25 });
  });

  it('captures lumMod and lumOff modifiers on role colors as 0..1 ratios', () => {
    // PPTX produces `<a:lumMod val="95000"/>` on a `bg1` schemeClr to
    // express "95% luminance" — a light gray derived from white. The
    // importer normalizes OOXML thousandths to 0..1 so the renderer
    // can apply the HSL shift directly without re-scaling at every
    // paint. Matches `resolveColor`'s 0..1 expectation for tint/shade.
    expect(
      parseColorElement(
        colorEl(`<a:schemeClr val="bg1"><a:lumMod val="95000"/></a:schemeClr>`),
      ),
    ).toEqual({ kind: 'role', role: 'background', lumMod: 0.95 });
    expect(
      parseColorElement(
        colorEl(`<a:schemeClr val="bg1"><a:lumMod val="75000"/></a:schemeClr>`),
      ),
    ).toEqual({ kind: 'role', role: 'background', lumMod: 0.75 });
    expect(
      parseColorElement(
        colorEl(`<a:schemeClr val="dk1"><a:lumOff val="10000"/></a:schemeClr>`),
      ),
    ).toEqual({ kind: 'role', role: 'text', lumOff: 0.1 });
    // lumMod and lumOff frequently appear together (HSL luminance shift).
    expect(
      parseColorElement(
        colorEl(
          `<a:schemeClr val="accent1"><a:lumMod val="75000"/><a:lumOff val="25000"/></a:schemeClr>`,
        ),
      ),
    ).toEqual({ kind: 'role', role: 'accent1', lumMod: 0.75, lumOff: 0.25 });
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

  it('captures `<a:alpha>` on srgbClr as a normalized 0..1 value', () => {
    expect(
      parseColorElement(
        colorEl(`<a:srgbClr val="9E9E9E"><a:alpha val="0"/></a:srgbClr>`),
      ),
    ).toEqual({ kind: 'srgb', value: '#9E9E9E', alpha: 0 });
    expect(
      parseColorElement(
        colorEl(`<a:srgbClr val="FF0000"><a:alpha val="50000"/></a:srgbClr>`),
      ),
    ).toEqual({ kind: 'srgb', value: '#FF0000', alpha: 0.5 });
  });

  it('captures `<a:alpha>` on schemeClr alongside tint/shade', () => {
    expect(
      parseColorElement(
        colorEl(
          `<a:schemeClr val="accent3"><a:tint val="50000"/><a:alpha val="25000"/></a:schemeClr>`,
        ),
      ),
    ).toEqual({ kind: 'role', role: 'accent3', tint: 0.5, alpha: 0.25 });
  });

  it('captures `<a:alpha>` on sysClr (resolved via lastClr) and prstClr', () => {
    expect(
      parseColorElement(
        colorEl(
          `<a:sysClr val="windowText" lastClr="2B2B2B"><a:alpha val="0"/></a:sysClr>`,
        ),
      ),
    ).toEqual({ kind: 'srgb', value: '#2B2B2B', alpha: 0 });
    expect(
      parseColorElement(
        colorEl(`<a:prstClr val="red"><a:alpha val="80000"/></a:prstClr>`),
      ),
    ).toEqual({ kind: 'srgb', value: '#FF0000', alpha: 0.8 });
  });

  it('omits the alpha key entirely when no `<a:alpha>` is present', () => {
    expect(
      parseColorElement(colorEl(`<a:srgbClr val="123456"/>`)),
    ).toEqual({ kind: 'srgb', value: '#123456' });
  });

  it('omits the alpha key when other modifiers are present but `<a:alpha>` is not', () => {
    // Regression guard: an earlier draft spread `alpha: undefined` into
    // the result, which broke `toEqual` shape checks and serialized as
    // `null` through some JSON pipelines.
    const out = parseColorElement(
      colorEl(`<a:schemeClr val="accent3"><a:tint val="50000"/></a:schemeClr>`),
    );
    expect(out).toEqual({ kind: 'role', role: 'accent3', tint: 0.5 });
    expect(Object.prototype.hasOwnProperty.call(out, 'alpha')).toBe(false);
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
