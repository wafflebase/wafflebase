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
