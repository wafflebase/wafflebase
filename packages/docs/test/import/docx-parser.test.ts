// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { parseRelationships, parseParagraph, parsePageSetup } from '../../src/import/docx-parser.js';

describe('parseRelationships', () => {
  it('should parse document.xml.rels into rId → target map', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
    <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
      <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.png"/>
      <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/>
    </Relationships>`;
    const rels = parseRelationships(xml);
    expect(rels.get('rId1')).toEqual({ target: 'media/image1.png', type: 'image' });
    expect(rels.get('rId2')).toEqual({ target: 'header1.xml', type: 'header' });
  });
});

describe('parseParagraph', () => {
  it('should extract text runs from a paragraph', () => {
    const xml = `<w:p xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
      <w:r><w:t>Hello</w:t></w:r>
      <w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve"> World</w:t></w:r>
    </w:p>`;
    const el = new DOMParser().parseFromString(xml, 'text/xml').documentElement;
    const result = parseParagraph(el);
    expect(result.inlines).toHaveLength(2);
    expect(result.inlines[0].text).toBe('Hello');
    expect(result.inlines[0].style.bold).toBeUndefined();
    expect(result.inlines[1].text).toBe(' World');
    expect(result.inlines[1].style.bold).toBe(true);
  });

  it('should handle empty paragraphs', () => {
    const xml = `<w:p xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"></w:p>`;
    const el = new DOMParser().parseFromString(xml, 'text/xml').documentElement;
    const result = parseParagraph(el);
    expect(result.inlines).toHaveLength(1);
    expect(result.inlines[0].text).toBe('');
  });
});

describe('parsePageSetup', () => {
  it('should parse sectPr into PageSetup', () => {
    const xml = `<w:sectPr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
      <w:pgSz w:w="11906" w:h="16838"/>
      <w:pgMar w:top="1440" w:right="1080" w:bottom="1440" w:left="1080"/>
    </w:sectPr>`;
    const el = new DOMParser().parseFromString(xml, 'text/xml').documentElement;
    const setup = parsePageSetup(el);
    // A4 paper: 11906 twips wide ≈ 794 px
    expect(setup.paperSize.width).toBeCloseTo(794, 0);
    expect(setup.paperSize.height).toBeCloseTo(1123, 0);
    expect(setup.margins.top).toBeCloseTo(96, 0);
    expect(setup.margins.left).toBeCloseTo(72, 0);
  });
});
