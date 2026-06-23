import { describe, it, expect } from 'vitest';
import { themeToXml } from '../../../src/export/pptx/theme.js';
import { layoutToXml } from '../../../src/export/pptx/layout.js';
import { defaultLight } from '../../../src/themes/default-light.js';
import { BUILT_IN_LAYOUTS } from '../../../src/model/layout.js';

describe('theme/layout', () => {
  it('emits a 12-slot clrScheme and a fontScheme', () => {
    const xml = themeToXml(defaultLight, 1);
    expect(xml).toContain('<a:clrScheme');
    expect(xml).toContain('<a:dk1>');
    expect(xml).toContain('<a:accent1>');
    expect(xml).toContain('<a:fontScheme');
  });

  it('emits srgbClr values from ColorScheme hex (not schemeClr)', () => {
    const xml = themeToXml(defaultLight, 1);
    // dk1 should contain the text color as srgb, not a role reference
    expect(xml).toContain('<a:srgbClr val="1A1A1A"/>');  // text = '#1A1A1A'
    expect(xml).toContain('<a:srgbClr val="FFFFFF"/>');   // background = '#FFFFFF'
    expect(xml).toContain('<a:srgbClr val="1A73E8"/>');   // accent1 = '#1A73E8'
    // Must NOT use schemeClr in clrScheme (that would be circular)
    expect(xml).not.toContain('<a:schemeClr val="tx1"/>');
    expect(xml).not.toContain('<a:schemeClr val="bg1"/>');
  });

  it('emits all 12 clrScheme slots', () => {
    const xml = themeToXml(defaultLight, 1);
    for (const slot of ['dk1', 'lt1', 'dk2', 'lt2', 'accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6', 'hlink', 'folHlink']) {
      expect(xml).toContain(`<a:${slot}>`);
    }
  });

  it('emits fontScheme with major/minor from heading/body', () => {
    const xml = themeToXml(defaultLight, 1);
    expect(xml).toContain('<a:majorFont>');
    expect(xml).toContain('<a:minorFont>');
    expect(xml).toContain('typeface="Inter"');
  });

  it('includes fmtScheme', () => {
    const xml = themeToXml(defaultLight, 1);
    expect(xml).toContain('<a:fmtScheme');
  });

  it('emits layout type so import re-derives the same id', () => {
    const layout = BUILT_IN_LAYOUTS[0]; // blank
    const xml = layoutToXml(layout, 1);
    expect(xml).toContain('<p:sldLayout');
    expect(xml).toContain(`type="`);
  });

  it('round-trips layout type: every BUILT_IN_LAYOUTS id maps to an OOXML type', () => {
    for (const layout of BUILT_IN_LAYOUTS) {
      const xml = layoutToXml(layout, 1);
      expect(xml).toContain('<p:sldLayout');
      expect(xml).toMatch(/type="[a-zA-Z]+"/);
    }
  });

  it('round-trip: exported theme xml contains every ColorScheme value as srgb hex', () => {
    const xml = themeToXml(defaultLight, 1);
    const c = defaultLight.colors;
    const toHex = (h: string) => h.replace(/^#/, '').toUpperCase();
    expect(xml).toContain(`val="${toHex(c.text)}"`);
    expect(xml).toContain(`val="${toHex(c.background)}"`);
    expect(xml).toContain(`val="${toHex(c.textSecondary)}"`);
    expect(xml).toContain(`val="${toHex(c.backgroundAlt)}"`);
    expect(xml).toContain(`val="${toHex(c.accent1)}"`);
    expect(xml).toContain(`val="${toHex(c.accent2)}"`);
    expect(xml).toContain(`val="${toHex(c.accent3)}"`);
    expect(xml).toContain(`val="${toHex(c.accent4)}"`);
    expect(xml).toContain(`val="${toHex(c.accent5)}"`);
    expect(xml).toContain(`val="${toHex(c.accent6)}"`);
    expect(xml).toContain(`val="${toHex(c.hyperlink)}"`);
    expect(xml).toContain(`val="${toHex(c.visitedHyperlink)}"`);
  });
});
