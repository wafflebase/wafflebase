import { describe, it, expect } from 'vitest';
import {
  solidFillXml,
  gradFillXml,
  fillXml,
  colorChildXml,
  ROLE_TO_SCHEME,
  colorFromStringOrTheme,
} from '../../../src/export/pptx/color';
import { SCHEME_TO_ROLE } from '../../../src/import/pptx/color';

describe('color', () => {
  it('maps every role to a scheme name', () => {
    expect(ROLE_TO_SCHEME.text).toBe('tx1');
    expect(ROLE_TO_SCHEME.background).toBe('bg1');
    expect(ROLE_TO_SCHEME.accent1).toBe('accent1');
    expect(ROLE_TO_SCHEME.hyperlink).toBe('hlink');
  });

  it('emits schemeClr with modifiers', () => {
    const xml = colorChildXml({ kind: 'role', role: 'accent1', lumMod: 75000, alpha: 50000 });
    expect(xml).toContain('<a:schemeClr val="accent1">');
    expect(xml).toContain('<a:lumMod val="75000"/>');
    expect(xml).toContain('<a:alpha val="50000"/>');
  });

  it('emits srgbClr', () => {
    expect(colorChildXml({ kind: 'srgb', value: '#FF0000' })).toBe('<a:srgbClr val="FF0000"/>');
  });

  it('wraps in solidFill', () => {
    expect(solidFillXml({ kind: 'srgb', value: '#00FF00' })).toBe('<a:solidFill><a:srgbClr val="00FF00"/></a:solidFill>');
  });

  it('emits a linear gradFill with stops + lin angle', () => {
    const xml = gradFillXml({
      kind: 'gradient',
      type: 'linear',
      angle: Math.PI / 4, // 45°
      stops: [
        { pos: 0, color: { kind: 'srgb', value: '#0093FF' } },
        { pos: 1, color: { kind: 'srgb', value: '#006AFF' } },
      ],
    });
    expect(xml).toBe(
      '<a:gradFill><a:gsLst>' +
        '<a:gs pos="0"><a:srgbClr val="0093FF"/></a:gs>' +
        '<a:gs pos="100000"><a:srgbClr val="006AFF"/></a:gs>' +
        '</a:gsLst><a:lin ang="2700000" scaled="1"/></a:gradFill>',
    );
  });

  it('fillXml dispatches solid vs gradient by kind', () => {
    expect(fillXml({ kind: 'srgb', value: '#00FF00' })).toBe(
      '<a:solidFill><a:srgbClr val="00FF00"/></a:solidFill>',
    );
    expect(
      fillXml({
        kind: 'gradient',
        type: 'linear',
        angle: 0,
        stops: [
          { pos: 0, color: { kind: 'srgb', value: '#112233' } },
          { pos: 1, color: { kind: 'srgb', value: '#445566' } },
        ],
      }),
    ).toContain('<a:gradFill>');
  });

  it('fillXml degrades a <2-stop gradient to a solid (never emits invalid gradFill)', () => {
    // CT_GradientStopList requires >=2 stops; a collapsed gradient must not
    // export a lone <a:gs> or PowerPoint rejects the file.
    const xml = fillXml({
      kind: 'gradient',
      type: 'linear',
      angle: 0,
      stops: [{ pos: 0, color: { kind: 'srgb', value: '#112233' } }],
    });
    expect(xml).toBe('<a:solidFill><a:srgbClr val="112233"/></a:solidFill>');
    expect(xml).not.toContain('gradFill');
  });

  it('converts string to srgb ThemeColor', () => {
    const result = colorFromStringOrTheme('#FF0000');
    expect(result).toEqual({ kind: 'srgb', value: '#FF0000' });
  });

  it('passes through ThemeColor objects', () => {
    const tc = { kind: 'role' as const, role: 'text' as const };
    expect(colorFromStringOrTheme(tc)).toEqual(tc);
  });

  it('round-trips SCHEME_TO_ROLE through ROLE_TO_SCHEME', () => {
    // Verify that every role in ROLE_TO_SCHEME maps back to itself through SCHEME_TO_ROLE
    Object.entries(ROLE_TO_SCHEME).forEach(([role, scheme]) => {
      const roundTripped = SCHEME_TO_ROLE[scheme];
      expect(roundTripped).toBe(role);
    });
  });

  it('escapes special chars in srgbClr val attribute', () => {
    // A malformed hex value containing " or & must not produce raw special
    // characters inside the XML attribute value.
    const xml = colorChildXml({ kind: 'srgb', value: 'FF00"00' });
    // The " must be escaped; no raw " inside the val attribute
    expect(xml).not.toMatch(/val="[^"]*"[^/]/);
    expect(xml).toContain('&quot;');
  });
});
