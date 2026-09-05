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
    // Present in the source → authored by the paragraph, so it outranks the
    // named style (OOXML's own formatting hierarchy).
    expect(result.blockStyle.authoredMarginTop).toBe(true);
    expect(result.blockStyle.authoredMarginBottom).toBe(true);
  });

  it('keeps an explicit w:before="0" / w:after="0"', () => {
    // What Word's one-click "Remove Space Before Paragraph" writes. `0` is a
    // valid explicit `ST_TwipsMeasure`, not an absence — and the old guard
    // `if (before)` did not even drop it (`Boolean("0") === true`), it imported
    // the zero and then let the named style's 27 px silently replace it,
    // because nothing recorded that the author had chosen it.
    const xml = '<w:pPr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:spacing w:before="0" w:after="0"/></w:pPr>';
    const el = new DOMParser().parseFromString(xml, 'text/xml').documentElement;
    const result = mapParagraphProperties(el);
    expect(result.blockStyle.marginTop).toBe(0);
    expect(result.blockStyle.marginBottom).toBe(0);
    expect(result.blockStyle.authoredMarginTop).toBe(true);
    expect(result.blockStyle.authoredMarginBottom).toBe(true);
  });

  it('keeps Word\'s 1.5 line spacing (w:line="360")', () => {
    // 360/240 = exactly 1.5, which is `DEFAULT_BLOCK_STYLE.lineHeight` — the
    // value the resolver's legacy fallback reads as "inherit". On a Heading 1
    // that turned Word's 1.5 into the style's 1.2 with nothing to show for it.
    const xml = '<w:pPr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:spacing w:line="360" w:lineRule="auto"/></w:pPr>';
    const el = new DOMParser().parseFromString(xml, 'text/xml').documentElement;
    const result = mapParagraphProperties(el);
    expect(result.blockStyle.lineHeight).toBe(1.5);
    expect(result.blockStyle.authoredLineHeight).toBe(true);
  });

  it('marks nothing when the paragraph specifies no spacing', () => {
    // Absence must stay absence, so a paragraph that overrode nothing keeps
    // inheriting its named style's spacing.
    const xml = '<w:pPr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:jc w:val="center"/></w:pPr>';
    const el = new DOMParser().parseFromString(xml, 'text/xml').documentElement;
    const result = mapParagraphProperties(el);
    expect(result.blockStyle.authoredMarginTop).toBeUndefined();
    expect(result.blockStyle.authoredMarginBottom).toBeUndefined();
    expect(result.blockStyle.authoredLineHeight).toBeUndefined();
  });

  it('marks only the fields the w:spacing element carries', () => {
    const xml = '<w:pPr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:spacing w:before="120"/></w:pPr>';
    const el = new DOMParser().parseFromString(xml, 'text/xml').documentElement;
    const result = mapParagraphProperties(el);
    expect(result.blockStyle.authoredMarginTop).toBe(true);
    expect(result.blockStyle.authoredMarginBottom).toBeUndefined();
    expect(result.blockStyle.authoredLineHeight).toBeUndefined();
  });

  it('ignores w:line="0" rather than dividing by 240', () => {
    const xml = '<w:pPr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:spacing w:line="0"/></w:pPr>';
    const el = new DOMParser().parseFromString(xml, 'text/xml').documentElement;
    const result = mapParagraphProperties(el);
    expect(result.blockStyle.lineHeight).toBe(1.5);
    expect(result.blockStyle.authoredLineHeight).toBeUndefined();
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

  // Single-number CellStyle.padding can only carry one value, so the loss
  // direction matters: use the max of specified sides so text never collides
  // with the cell border, even when the source asymmetrically padded one side.
  it('should map w:tcMar to padding as max of specified dxa sides', () => {
    const xml =
      '<w:tcPr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
      '<w:tcMar>' +
      '<w:top w:w="100" w:type="dxa"/>' +
      '<w:bottom w:w="100" w:type="dxa"/>' +
      '<w:left w:w="140" w:type="dxa"/>' +
      '<w:right w:w="140" w:type="dxa"/>' +
      '</w:tcMar></w:tcPr>';
    const el = new DOMParser().parseFromString(xml, 'text/xml').documentElement;
    const result = mapTableCellProperties(el);
    // 140 twips × 96/1440 ≈ 9.333 px
    expect(result.padding).toBeCloseTo((140 * 96) / 1440, 5);
  });

  it('should ignore w:tcMar sides whose type is not dxa', () => {
    const xml =
      '<w:tcPr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
      '<w:tcMar><w:top w:w="100" w:type="pct"/></w:tcMar></w:tcPr>';
    const el = new DOMParser().parseFromString(xml, 'text/xml').documentElement;
    const result = mapTableCellProperties(el);
    expect(result.padding).toBeUndefined();
  });

  it('should map w:vAlign center/top/bottom to verticalAlign', () => {
    const make = (val: string) => {
      const xml =
        '<w:tcPr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
        `<w:vAlign w:val="${val}"/></w:tcPr>`;
      const el = new DOMParser().parseFromString(xml, 'text/xml').documentElement;
      return mapTableCellProperties(el);
    };
    // OOXML uses "center"; the docs model uses "middle".
    expect(make('center').verticalAlign).toBe('middle');
    expect(make('top').verticalAlign).toBe('top');
    expect(make('bottom').verticalAlign).toBe('bottom');
  });
});

describe('mapHighlightColor', () => {
  it('should map named highlight colors', () => {
    expect(mapHighlightColor('yellow')).toBe('#FFFF00');
    expect(mapHighlightColor('red')).toBe('#FF0000');
    expect(mapHighlightColor('green')).toBe('#00FF00');
  });
});

describe('w:lineRule decides whether the leading is authored', () => {
  const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const pPr = (spacing: string) =>
    new DOMParser().parseFromString(
      `<w:pPr xmlns:w="${W}"><w:spacing ${spacing}/></w:pPr>`, 'text/xml',
    ).documentElement;

  it('marks an auto (multiplier) rule as authored', () => {
    // Word's "1.5 line spacing" preset. Without the marker this lands on the
    // sentinel and reads back as "inherit", so the pick would not survive.
    for (const s of ['w:line="360"', 'w:line="360" w:lineRule="auto"']) {
      const r = mapParagraphProperties(pPr(s));
      expect(r.blockStyle?.lineHeight).toBe(1.5);
      expect(r.blockStyle?.authoredLineHeight).toBe(true);
    }
  });

  it('leaves exact / atLeast unmarked, because the value is misread', () => {
    // Under these rules `w:line` is absolute twips, which this model cannot
    // express. The value is still imported so round-tripping documents do not
    // regress, but pinning a misreading as the user's intent would stop the
    // named style from supplying leading it can actually get right.
    for (const rule of ['exact', 'atLeast']) {
      const r = mapParagraphProperties(pPr(`w:line="240" w:lineRule="${rule}"`));
      expect(r.blockStyle?.lineHeight).toBe(1);
      expect(r.blockStyle?.authoredLineHeight).toBeUndefined();
    }
  });
});
