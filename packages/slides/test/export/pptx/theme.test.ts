import { describe, it, expect } from 'vitest';
import { themeToXml } from '../../../src/export/pptx/theme.js';
import { layoutToXml } from '../../../src/export/pptx/layout.js';
import { masterToXml } from '../../../src/export/pptx/master.js';
import { defaultLight } from '../../../src/themes/default-light.js';
import { BUILT_IN_LAYOUTS } from '../../../src/model/layout.js';
import { DEFAULT_MASTER } from '../../../src/model/master.js';

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

  it('themeToXml starts with XML declaration', () => {
    const xml = themeToXml(defaultLight, 1);
    expect(xml).toMatch(/^<\?xml version="1\.0" encoding="UTF-8" standalone="yes"\?>/);
  });

  it('masterToXml emits <p:sldMaster> and starts with XML declaration', () => {
    const xml = masterToXml(DEFAULT_MASTER, 1);
    expect(xml).toMatch(/^<\?xml version="1\.0" encoding="UTF-8" standalone="yes"\?>/);
    expect(xml).toContain('<p:sldMaster');
  });
});

describe('clrScheme slot normalization', () => {
  // `Theme.colors[role]` is typed as a string but holds whatever JSON was
  // persisted — the content PUT API lets an authenticated caller store an
  // arbitrary string there — and a `<a:clrScheme>` slot is mandatory, so it
  // cannot be dropped the way an omittable run color can.
  const withColor = (value: string) => ({
    ...defaultLight,
    colors: { ...defaultLight.colors, accent1: value },
  });

  it('normalizes shorthand and un-prefixed hex to 6 upper-case digits', () => {
    expect(themeToXml(withColor('#f00'), 1)).toContain('<a:accent1><a:srgbClr val="FF0000"/></a:accent1>');
    expect(themeToXml(withColor('1a73e8'), 1)).toContain('<a:accent1><a:srgbClr val="1A73E8"/></a:accent1>');
    expect(themeToXml(withColor('rgb(255, 0, 0)'), 1)).toContain('<a:accent1><a:srgbClr val="FF0000"/></a:accent1>');
  });

  it('falls back to black for a value the normalizer cannot express', () => {
    for (const bad of ['', 'not-a-color', 'transparent']) {
      expect(themeToXml(withColor(bad), 1)).toContain(
        '<a:accent1><a:srgbClr val="000000"/></a:accent1>',
      );
    }
  });

  it('never lets a hostile color close the val attribute', () => {
    const hostile = 'FF0000"/><a:custom val="pwned';
    const xml = themeToXml(withColor(hostile), 1);
    expect(xml).toContain('<a:accent1><a:srgbClr val="000000"/></a:accent1>');
    expect(xml).not.toContain('pwned');
    // Every emitted slot value is 6 hex digits by construction.
    for (const [, val] of xml.matchAll(/<a:srgbClr val="([^"]*)"\/>/g)) {
      expect(val).toMatch(/^[0-9A-F]{6}$/);
    }
  });
});

describe('BUILT_IN_TO_TYPE is a closed lookup', () => {
  // `layout.id` is persisted JSON: custom layouts carry arbitrary ids and the
  // content PUT API lets a caller store any string.
  it.each(['constructor', 'toString', '__proto__', 'my-custom-layout'])(
    'falls back to type="blank" for the layout id %s',
    (id) => {
      const xml = layoutToXml({ ...BUILT_IN_LAYOUTS[0], id }, 1);
      expect(xml).toContain('type="blank"');
      expect(xml).not.toContain('native code');
      expect(xml).not.toContain('type="undefined"');
    },
  );

  it('never lets a hostile layout id close the type attribute', () => {
    const xml = layoutToXml(
      { ...BUILT_IN_LAYOUTS[0], id: 'blank" evil="1' },
      1,
    );
    expect(xml).toContain('type="blank"');
    expect(xml).not.toContain('evil=');
  });
});
