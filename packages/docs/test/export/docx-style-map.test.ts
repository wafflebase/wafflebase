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
