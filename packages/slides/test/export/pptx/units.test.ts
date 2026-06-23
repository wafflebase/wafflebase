import { describe, it, expect } from 'vitest';
import { pxToEmuX, pxToEmuY, radToRot60k, ptToHundredths } from '../../../src/export/pptx/units.js';
import { escapeXmlText, escapeXmlAttr } from '../../../src/export/pptx/xml.js';

describe('units', () => {
  it('maps full slide width/height to widescreen EMU', () => {
    expect(pxToEmuX(1920)).toBe(12_192_000);
    expect(pxToEmuY(1080)).toBe(6_858_000);
    expect(pxToEmuX(960)).toBe(6_096_000);
  });
  it('converts radians to 60000ths', () => {
    expect(radToRot60k(Math.PI / 2)).toBe(5_400_000);
    expect(radToRot60k(0)).toBe(0);
  });
  it('converts points to hundredths', () => {
    expect(ptToHundredths(18)).toBe(1800);
  });
});

describe('xml escaping', () => {
  it('escapes text nodes', () => {
    expect(escapeXmlText('a & b < c > d')).toBe('a &amp; b &lt; c &gt; d');
  });
  it('escapes attributes including quotes', () => {
    expect(escapeXmlAttr(`"x" & 'y'`)).toBe('&quot;x&quot; &amp; &apos;y&apos;');
  });
});
