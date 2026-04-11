// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { mapRunProperties, mapParagraphProperties, mapTableCellProperties, mapHighlightColor } from '../../src/import/docx-style-map.js';

describe('mapRunProperties', () => {
  it('should map bold', () => {
    const xml = '<w:rPr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:b/></w:rPr>';
    const el = new DOMParser().parseFromString(xml, 'text/xml').documentElement;
    const style = mapRunProperties(el);
    expect(style.bold).toBe(true);
  });

  it('should map font size from half-points', () => {
    const xml = '<w:rPr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:sz w:val="24"/></w:rPr>';
    const el = new DOMParser().parseFromString(xml, 'text/xml').documentElement;
    const style = mapRunProperties(el);
    expect(style.fontSize).toBe(12);
  });

  it('should map font family', () => {
    const xml = '<w:rPr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:rFonts w:ascii="Arial"/></w:rPr>';
    const el = new DOMParser().parseFromString(xml, 'text/xml').documentElement;
    const style = mapRunProperties(el);
    expect(style.fontFamily).toBe('Arial');
  });

  it('should map text color', () => {
    const xml = '<w:rPr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:color w:val="FF0000"/></w:rPr>';
    const el = new DOMParser().parseFromString(xml, 'text/xml').documentElement;
    const style = mapRunProperties(el);
    expect(style.color).toBe('#FF0000');
  });

  it('should map underline, italic, strikethrough', () => {
    const xml = '<w:rPr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:i/><w:u w:val="single"/><w:strike/></w:rPr>';
    const el = new DOMParser().parseFromString(xml, 'text/xml').documentElement;
    const style = mapRunProperties(el);
    expect(style.italic).toBe(true);
    expect(style.underline).toBe(true);
    expect(style.strikethrough).toBe(true);
  });

  it('should map superscript', () => {
    const xml = '<w:rPr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:vertAlign w:val="superscript"/></w:rPr>';
    const el = new DOMParser().parseFromString(xml, 'text/xml').documentElement;
    const style = mapRunProperties(el);
    expect(style.superscript).toBe(true);
  });

  it('should enable underline for bare <w:u/> without w:val', () => {
    // A bare <w:u/> is valid OOXML shorthand for "underline enabled".
    const xml = '<w:rPr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:u/></w:rPr>';
    const el = new DOMParser().parseFromString(xml, 'text/xml').documentElement;
    const style = mapRunProperties(el);
    expect(style.underline).toBe(true);
  });

  it('should leave underline unset for <w:u w:val="none"/>', () => {
    const xml = '<w:rPr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:u w:val="none"/></w:rPr>';
    const el = new DOMParser().parseFromString(xml, 'text/xml').documentElement;
    const style = mapRunProperties(el);
    expect(style.underline).toBeUndefined();
  });

  // OOXML uses <w:b w:val="0"/> (and the equivalent "false") to explicitly
  // clear an inherited bold. Missing val means on. form.docx relies on this
  // to reset style from paragraph defaults, so treating "0" as on forces
  // bold/italic/strikethrough across most runs.
  it('should treat <w:b w:val="0"/> as bold off', () => {
    const xml = '<w:rPr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:b w:val="0"/></w:rPr>';
    const el = new DOMParser().parseFromString(xml, 'text/xml').documentElement;
    const style = mapRunProperties(el);
    expect(style.bold).toBeUndefined();
  });

  it('should treat <w:b w:val="false"/> as bold off', () => {
    const xml = '<w:rPr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:b w:val="false"/></w:rPr>';
    const el = new DOMParser().parseFromString(xml, 'text/xml').documentElement;
    const style = mapRunProperties(el);
    expect(style.bold).toBeUndefined();
  });

  it('should treat <w:b w:val="1"/> as bold on', () => {
    const xml = '<w:rPr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:b w:val="1"/></w:rPr>';
    const el = new DOMParser().parseFromString(xml, 'text/xml').documentElement;
    const style = mapRunProperties(el);
    expect(style.bold).toBe(true);
  });

  it('should treat <w:i w:val="0"/> as italic off', () => {
    const xml = '<w:rPr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:i w:val="0"/></w:rPr>';
    const el = new DOMParser().parseFromString(xml, 'text/xml').documentElement;
    const style = mapRunProperties(el);
    expect(style.italic).toBeUndefined();
  });

  it('should treat <w:i w:val="false"/> as italic off', () => {
    const xml = '<w:rPr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:i w:val="false"/></w:rPr>';
    const el = new DOMParser().parseFromString(xml, 'text/xml').documentElement;
    const style = mapRunProperties(el);
    expect(style.italic).toBeUndefined();
  });

  it('should treat <w:strike w:val="0"/> as strikethrough off', () => {
    const xml = '<w:rPr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:strike w:val="0"/></w:rPr>';
    const el = new DOMParser().parseFromString(xml, 'text/xml').documentElement;
    const style = mapRunProperties(el);
    expect(style.strikethrough).toBeUndefined();
  });

  it('should treat <w:strike w:val="false"/> as strikethrough off', () => {
    const xml = '<w:rPr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:strike w:val="false"/></w:rPr>';
    const el = new DOMParser().parseFromString(xml, 'text/xml').documentElement;
    const style = mapRunProperties(el);
    expect(style.strikethrough).toBeUndefined();
  });

  it('should not apply yellow highlight for <w:highlight w:val="none"/>', () => {
    // Regression: mapHighlightColor falls back to yellow for unknown names,
    // so "none" must short-circuit before the lookup.
    const xml = '<w:rPr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:highlight w:val="none"/></w:rPr>';
    const el = new DOMParser().parseFromString(xml, 'text/xml').documentElement;
    const style = mapRunProperties(el);
    expect(style.backgroundColor).toBeUndefined();
  });
});

describe('mapParagraphProperties', () => {
  it('should map center alignment', () => {
    const xml = '<w:pPr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:jc w:val="center"/></w:pPr>';
    const el = new DOMParser().parseFromString(xml, 'text/xml').documentElement;
    const result = mapParagraphProperties(el);
    expect(result.blockStyle.alignment).toBe('center');
  });

  it('should map "both" to justify', () => {
    const xml = '<w:pPr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:jc w:val="both"/></w:pPr>';
    const el = new DOMParser().parseFromString(xml, 'text/xml').documentElement;
    const result = mapParagraphProperties(el);
    expect(result.blockStyle.alignment).toBe('justify');
  });

  it('should map spacing to marginTop and marginBottom', () => {
    const xml = '<w:pPr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:spacing w:before="120" w:after="240"/></w:pPr>';
    const el = new DOMParser().parseFromString(xml, 'text/xml').documentElement;
    const result = mapParagraphProperties(el);
    expect(result.blockStyle.marginTop).toBeCloseTo(8, 0);
    expect(result.blockStyle.marginBottom).toBeCloseTo(16, 0);
  });
});

describe('mapTableCellProperties', () => {
  it('should map background fill, gridSpan, and vMerge', () => {
    const xml = '<w:tcPr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:shd w:fill="DDEEFF"/><w:gridSpan w:val="2"/><w:vMerge w:val="restart"/></w:tcPr>';
    const el = new DOMParser().parseFromString(xml, 'text/xml').documentElement;
    const result = mapTableCellProperties(el);
    expect(result.backgroundColor).toBe('#DDEEFF');
    expect(result.colSpan).toBe(2);
    expect(result.vMerge).toBe('restart');
  });

  it('should map tcBorders to per-side border styles', () => {
    const xml = '<w:tcPr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:tcBorders><w:top w:sz="8" w:color="000000" w:val="single"/><w:bottom w:val="none"/></w:tcBorders></w:tcPr>';
    const el = new DOMParser().parseFromString(xml, 'text/xml').documentElement;
    const result = mapTableCellProperties(el);
    expect(result.borderTop?.color).toBe('#000000');
    expect(result.borderTop?.style).toBe('solid');
    expect(result.borderBottom?.style).toBe('none');
  });
});

describe('mapHighlightColor', () => {
  it('should map named highlight colors', () => {
    expect(mapHighlightColor('yellow')).toBe('#FFFF00');
    expect(mapHighlightColor('red')).toBe('#FF0000');
    expect(mapHighlightColor('green')).toBe('#00FF00');
  });
});
