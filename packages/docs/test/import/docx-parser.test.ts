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

  it('should preserve document order of text, tabs, and breaks within a run', () => {
    // Regression: previously the parser appended all tabs/breaks after all
    // text, turning "A<w:tab/>B<w:br/>C" into "ABC\t\n" instead of "A\tB\nC".
    const xml = `<w:p xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
      <w:r>
        <w:t>A</w:t><w:tab/><w:t>B</w:t><w:br/><w:t>C</w:t>
      </w:r>
    </w:p>`;
    const el = new DOMParser().parseFromString(xml, 'text/xml').documentElement;
    const result = parseParagraph(el);
    expect(result.inlines).toHaveLength(1);
    expect(result.inlines[0].text).toBe('A\tB\nC');
  });

  it('should include runs wrapped in an inline w:sdt in document order', () => {
    // An inline <w:sdt> (content control) inside a paragraph carries real,
    // visible text that belongs to that paragraph — Google Docs wraps most
    // exported body content this way. Its runs must be collected in document
    // order alongside the paragraph's direct-child runs, not dropped.
    const xml = `<w:p xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
      <w:r><w:t>Outer</w:t></w:r>
      <w:sdt>
        <w:sdtContent>
          <w:r><w:t xml:space="preserve"> Nested</w:t></w:r>
        </w:sdtContent>
      </w:sdt>
    </w:p>`;
    const el = new DOMParser().parseFromString(xml, 'text/xml').documentElement;
    const result = parseParagraph(el);
    expect(result.inlines.map((i) => i.text)).toEqual(['Outer', ' Nested']);
  });

  it('should include runs wrapped in a hyperlink nested inside a w:sdt', () => {
    const xml = `<w:p xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
      <w:sdt>
        <w:sdtContent>
          <w:hyperlink><w:r><w:t>Link</w:t></w:r></w:hyperlink>
        </w:sdtContent>
      </w:sdt>
    </w:p>`;
    const el = new DOMParser().parseFromString(xml, 'text/xml').documentElement;
    const result = parseParagraph(el);
    expect(result.inlines.map((i) => i.text)).toEqual(['Link']);
  });

  it('should drop runs inside a tracked-change w:del (deleted content)', () => {
    // Deleted content must not reappear on import. Deleted text uses
    // <w:delText> (not read anyway), but deleted <w:tab/>/<w:br/> glyphs would
    // otherwise leak as spurious whitespace once w:del became transparent.
    const xml = `<w:p xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
      <w:r><w:t>Kept</w:t></w:r>
      <w:del>
        <w:r><w:tab/><w:br/><w:delText>gone</w:delText></w:r>
      </w:del>
    </w:p>`;
    const el = new DOMParser().parseFromString(xml, 'text/xml').documentElement;
    const result = parseParagraph(el);
    expect(result.inlines.map((i) => i.text)).toEqual(['Kept']);
  });

  it('should drop the source runs of a tracked move (w:moveFrom)', () => {
    // The move source (w:moveFrom) duplicates text that lives at the move
    // destination (w:moveTo); only the destination should import.
    const xml = `<w:p xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
      <w:moveFrom><w:r><w:t>Moved</w:t></w:r></w:moveFrom>
      <w:moveTo><w:r><w:t>Moved</w:t></w:r></w:moveTo>
    </w:p>`;
    const el = new DOMParser().parseFromString(xml, 'text/xml').documentElement;
    const result = parseParagraph(el);
    expect(result.inlines.map((i) => i.text)).toEqual(['Moved']);
  });

  it('should keep ruby base text but drop the phonetic guide (w:rt)', () => {
    const xml = `<w:p xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
      <w:r><w:ruby>
        <w:rt><w:r><w:t>かん</w:t></w:r></w:rt>
        <w:rubyBase><w:r><w:t>漢</w:t></w:r></w:rubyBase>
      </w:ruby></w:r>
    </w:p>`;
    const el = new DOMParser().parseFromString(xml, 'text/xml').documentElement;
    const result = parseParagraph(el);
    expect(result.inlines.map((i) => i.text)).toEqual(['漢']);
  });

  it('should not adopt a nested textbox paragraph’s pPr', () => {
    // The outer paragraph has no pPr of its own; a paragraph nested inside a
    // drawing textbox does. A descendant [0] pPr lookup would wrongly promote
    // the outer paragraph to the nested heading style — and the nested run
    // must stay out of the outer paragraph's inlines (blocked by the w:p floor).
    const xml = `<w:p xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
      <w:r><w:t>Body</w:t></w:r>
      <w:r><w:drawing><w:txbxContent>
        <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Inner</w:t></w:r></w:p>
      </w:txbxContent></w:drawing></w:r>
    </w:p>`;
    const el = new DOMParser().parseFromString(xml, 'text/xml').documentElement;
    const result = parseParagraph(el);
    expect(result.inlines.map((i) => i.text)).toEqual(['Body']);
    expect(result.blockType).toBe('paragraph');
    expect(result.headingLevel).toBeUndefined();
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
