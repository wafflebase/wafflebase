import { describe, it, expect } from 'vitest';
import { solidFillXml, colorChildXml, ROLE_TO_SCHEME, colorFromStringOrTheme } from '../../../src/export/pptx/color';
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
});
