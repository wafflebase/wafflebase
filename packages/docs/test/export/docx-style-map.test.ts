import { describe, it, expect } from 'vitest';
import { buildRunPropertiesXml, buildParagraphPropertiesXml } from '../../src/export/docx-style-map.js';

describe('buildRunPropertiesXml', () => {
  it('should generate bold tag', () => {
    const xml = buildRunPropertiesXml({ bold: true });
    expect(xml).toContain('<w:b/>');
  });

  it('should generate font size in half-points', () => {
    const xml = buildRunPropertiesXml({ fontSize: 12 });
    expect(xml).toContain('<w:sz w:val="24"/>');
    expect(xml).toContain('<w:szCs w:val="24"/>');
  });

  it('should generate font family', () => {
    const xml = buildRunPropertiesXml({ fontFamily: 'Arial' });
    expect(xml).toContain('w:ascii="Arial"');
    expect(xml).toContain('w:hAnsi="Arial"');
    // Latin face: the East Asian slot defaults to Noto Sans KR so
    // Hangul runs render with Korean glyphs in Word, matching what the
    // docs view paints via the render-time Korean fallback splice.
    expect(xml).toContain('w:eastAsia="Noto Sans KR"');
  });

  it('keeps a Korean-capable family on the East Asian slot', () => {
    const xml = buildRunPropertiesXml({ fontFamily: 'Malgun Gothic' });
    expect(xml).toContain('w:ascii="Malgun Gothic"');
    expect(xml).toContain('w:eastAsia="Malgun Gothic"');
    expect(xml).not.toContain('Noto Sans KR');
  });

  it('emits Arial / Noto Sans KR defaults when no font family is set', () => {
    // Previously an undefined fontFamily skipped the rFonts block
    // entirely; Word then rendered Hangul-only runs with the doc
    // default (Calibri). Always emitting rFonts keeps Word in sync
    // with the docs view's render-time fallback.
    const xml = buildRunPropertiesXml({});
    expect(xml).toContain('w:ascii="Arial"');
    expect(xml).toContain('w:hAnsi="Arial"');
    expect(xml).toContain('w:eastAsia="Noto Sans KR"');
  });

  it('XML-escapes hostile fontFamily values in rFonts attributes', () => {
    // style.fontFamily originates from untrusted sources (PPTX/DOCX
    // imports, user input in the picker). Without escaping, a family
    // name containing XML-reserved characters (`&`, `"`, `<`, `>`)
    // would break the rFonts element or open it to attribute
    // injection in DOCX viewers.
    const xml = buildRunPropertiesXml({ fontFamily: 'A"B&<>C' });
    expect(xml).toContain('w:ascii="A&quot;B&amp;&lt;&gt;C"');
    expect(xml).toContain('w:hAnsi="A&quot;B&amp;&lt;&gt;C"');
    // The raw characters must NOT appear unescaped inside the
    // attribute — if any did, the surrounding "..." would close early
    // and Word would treat the rest as new attributes / elements.
    expect(xml).not.toContain('w:ascii="A"B');
    expect(xml).not.toContain('w:ascii="A&B');
  });

  it('XML-escapes hostile color and backgroundColor values', () => {
    // Colors reach the run as plain strings (imported .docx/.pptx, a
    // collaborating peer's Yorkie attribute) and are never validated as
    // colors, so stripping `#` alone leaves the same attribute-injection
    // hole the fontFamily escaping closes.
    const xml = buildRunPropertiesXml({
      color: '#00" w:themeColor="accent1',
      backgroundColor: '#ff0000"/><w:b/><w:shd w:fill="',
    });
    expect(xml).toContain('<w:color w:val="00&quot; w:themeColor=&quot;accent1"/>');
    expect(xml).toContain('ff0000&quot;/&gt;&lt;w:b/&gt;&lt;w:shd w:fill=&quot;');
    // No injected element escaped the attribute.
    expect(xml).not.toContain('w:themeColor="accent1"');
    expect(xml).not.toContain('<w:b/>');
  });

  it('escapes ampersand first so the other replacements do not re-escape it', () => {
    // If `&` were replaced after `<` / `>` / `"`, the entity references
    // those produced (`&lt;`, `&quot;`) would themselves get rewritten
    // into `&amp;lt;` / `&amp;quot;` — visibly garbled inside Word.
    const xml = buildRunPropertiesXml({ fontFamily: '<b>' });
    expect(xml).toContain('w:ascii="&lt;b&gt;"');
    expect(xml).not.toContain('w:ascii="&amp;lt;');
  });

  it('should generate color', () => {
    const xml = buildRunPropertiesXml({ color: '#FF0000' });
    expect(xml).toContain('<w:color w:val="FF0000"/>');
  });
});

describe('buildParagraphPropertiesXml', () => {
  it('should generate center alignment', () => {
    const xml = buildParagraphPropertiesXml({ alignment: 'center', lineHeight: 1.5, marginTop: 0, marginBottom: 8, textIndent: 0, marginLeft: 0 });
    expect(xml).toContain('<w:jc w:val="center"/>');
  });

  it('should generate justify as "both"', () => {
    const xml = buildParagraphPropertiesXml({ alignment: 'justify', lineHeight: 1.5, marginTop: 0, marginBottom: 8, textIndent: 0, marginLeft: 0 });
    expect(xml).toContain('<w:jc w:val="both"/>');
  });
});
