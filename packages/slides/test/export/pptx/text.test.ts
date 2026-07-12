// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { textBodyToXml } from '../../../src/export/pptx/text.js';
import { parseTextBody } from '../../../src/import/pptx/text.js';
import { ImportReport } from '../../../src/import/pptx/report.js';
import { parseXml } from '../../../src/import/pptx/xml.js';
import { DEFAULT_BLOCK_STYLE, type Block } from '@wafflebase/docs';

function para(text: string, style: Record<string, unknown> = {}): Block {
  return {
    id: 'b',
    type: 'paragraph',
    inlines: [{ text, style }],
    style: { ...DEFAULT_BLOCK_STYLE },
  } as Block;
}

describe('textBodyToXml', () => {
  it('emits bodyPr autofit and a run', () => {
    const xml = textBodyToXml({ blocks: [para('Hi')], autofit: 'shrink', verticalAnchor: 'middle' });
    expect(xml).toContain('<a:bodyPr');
    expect(xml).toContain('anchor="ctr"');
    expect(xml).toContain('<a:normAutofit/>');
    expect(xml).toContain('<a:t>Hi</a:t>');
  });

  it('emits run properties for bold/italic/size/color', () => {
    const xml = textBodyToXml({ blocks: [para('X', { bold: true, italic: true, fontSize: 24, color: '#FF0000' })] });
    expect(xml).toMatch(/<a:rPr[^>]*b="1"/);
    expect(xml).toMatch(/<a:rPr[^>]*i="1"/);
    expect(xml).toMatch(/<a:rPr[^>]*sz="2400"/);
    expect(xml).toContain('<a:srgbClr val="FF0000"/>');
  });

  it('escapes text', () => {
    expect(textBodyToXml({ blocks: [para('a < b & c')] })).toContain('<a:t>a &lt; b &amp; c</a:t>');
  });

  it('defaults absent autofit to spAutoFit', () => {
    expect(textBodyToXml({ blocks: [para('x')] })).toContain('<a:spAutoFit/>');
  });

  it('uses p:txBody wrapper when tag is p:txBody', () => {
    const xml = textBodyToXml({ blocks: [para('Hello')] }, 'p:txBody');
    expect(xml).toMatch(/^<p:txBody>/);
    expect(xml).toMatch(/<\/p:txBody>$/);
    expect(xml).toContain('<a:t>Hello</a:t>');
  });

  it('emits underline and strikethrough', () => {
    const xml = textBodyToXml({
      blocks: [para('U', { underline: true, strikethrough: true })],
    });
    expect(xml).toMatch(/<a:rPr[^>]*u="sng"/);
    expect(xml).toMatch(/<a:rPr[^>]*strike="sngStrike"/);
  });

  it('emits underline style + uFill color and round-trips them', () => {
    const dashed = textBodyToXml({
      blocks: [
        para('U', { underline: true, underlineStyle: 'dashed', underlineColor: '#FF0000' }),
      ],
    });
    expect(dashed).toMatch(/<a:rPr[^>]*u="dash"/);
    expect(dashed).toContain('<a:uFill><a:solidFill><a:srgbClr val="FF0000"/></a:solidFill></a:uFill>');
    // uFill must precede the typeface child per OOXML child order.
    const withFamily = textBodyToXml({
      blocks: [
        para('U', { underline: true, underlineColor: '#00FF00', fontFamily: 'Arial' }),
      ],
    });
    expect(withFamily.indexOf('<a:uFill')).toBeLessThan(withFamily.indexOf('<a:latin'));
    // Round-trip: dashed + color survive export → re-import.
    const el = parseXml(
      `<root xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ` +
        `xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">${textBodyToXml(
          { blocks: [para('U', { underline: true, underlineStyle: 'dashed', underlineColor: '#FF0000' })] },
          'p:txBody',
        )}</root>`,
    ).documentElement.firstElementChild!;
    const back = parseTextBody(el, { report: new ImportReport() });
    expect(back[0].inlines[0].style.underline).toBe(true);
    expect(back[0].inlines[0].style.underlineStyle).toBe('dashed');
    expect(back[0].inlines[0].style.underlineColor).toBeTruthy();
  });

  it('emits dblStrike for double strikethrough and round-trips it', () => {
    const xml = textBodyToXml({
      blocks: [para('D', { strikethrough: true, strikeStyle: 'double' })],
    });
    expect(xml).toMatch(/<a:rPr[^>]*strike="dblStrike"/);
    // Plain strikethrough stays single.
    expect(
      textBodyToXml({ blocks: [para('S', { strikethrough: true })] }),
    ).toMatch(/<a:rPr[^>]*strike="sngStrike"/);
    // Round-trip: dblStrike re-imports as strikethrough + strikeStyle double.
    const el = parseXml(
      `<root xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ` +
        `xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">${textBodyToXml(
          { blocks: [para('D', { strikethrough: true, strikeStyle: 'double' })] },
          'p:txBody',
        )}</root>`,
    ).documentElement.firstElementChild!;
    const back = parseTextBody(el, { report: new ImportReport() });
    expect(back[0].inlines[0].style.strikethrough).toBe(true);
    expect(back[0].inlines[0].style.strikeStyle).toBe('double');
  });

  it('emits spc for letterSpacing and round-trips it (incl. negative)', () => {
    expect(
      textBodyToXml({ blocks: [para('S', { letterSpacing: 1.5 })] }),
    ).toMatch(/<a:rPr[^>]*spc="150"/);
    expect(
      textBodyToXml({ blocks: [para('C', { letterSpacing: -0.5 })] }),
    ).toMatch(/<a:rPr[^>]*spc="-50"/);
    const el = parseXml(
      `<root xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ` +
        `xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">${textBodyToXml(
          { blocks: [para('S', { letterSpacing: 1.5 })] },
          'p:txBody',
        )}</root>`,
    ).documentElement.firstElementChild!;
    const back = parseTextBody(el, { report: new ImportReport() });
    expect(back[0].inlines[0].style.letterSpacing).toBe(1.5);
  });

  it('emits baseline for superscript and subscript', () => {
    expect(
      textBodyToXml({ blocks: [para('S', { superscript: true })] }),
    ).toMatch(/<a:rPr[^>]*baseline="30000"/);
    expect(
      textBodyToXml({ blocks: [para('s', { subscript: true })] }),
    ).toMatch(/<a:rPr[^>]*baseline="-25000"/);
  });

  it('round-trips superscript/subscript through export → re-import', () => {
    for (const key of ['superscript', 'subscript'] as const) {
      const block: Block = {
        id: 'b',
        type: 'paragraph',
        inlines: [{ text: 'x', style: { [key]: true } }],
        style: { ...DEFAULT_BLOCK_STYLE },
      };
      const xml = textBodyToXml({ blocks: [block] }, 'p:txBody');
      const el = parseXml(
        `<root xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ` +
          `xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">${xml}</root>`,
      ).documentElement.firstElementChild!;
      const reimported = parseTextBody(el, { report: new ImportReport() });
      expect(reimported[0].inlines[0].style[key]).toBe(true);
    }
  });

  it('emits font family', () => {
    const xml = textBodyToXml({ blocks: [para('F', { fontFamily: 'Arial' })] });
    expect(xml).toContain('<a:latin typeface="Arial"/>');
  });

  it('escapes double-quotes in fontFamily attribute', () => {
    const xml = textBodyToXml({ blocks: [para('Q', { fontFamily: 'Foo "Bar" Sans' })] });
    expect(xml).toContain('typeface="Foo &quot;Bar&quot; Sans"');
    expect(xml).not.toMatch(/typeface="[^"]*"[^/]/);
  });

  it('handles srgb StoredColor object', () => {
    const xml = textBodyToXml({
      blocks: [para('C', { color: { kind: 'srgb', value: '#00FF00' } })],
    });
    expect(xml).toContain('<a:srgbClr val="00FF00"/>');
  });

  it('handles role StoredColor object (theme color)', () => {
    const xml = textBodyToXml({
      blocks: [para('T', { color: { kind: 'role', role: 'text' } })],
    });
    expect(xml).toContain('<a:schemeClr val="tx1"/>');
  });

  it('emits noAutofit for autofit none and anchor bottom', () => {
    const xml = textBodyToXml({ blocks: [para('N')], autofit: 'none', verticalAnchor: 'bottom' });
    expect(xml).toContain('<a:noAutofit/>');
    expect(xml).toContain('anchor="b"');
  });

  it('emits anchor t for top vertical anchor', () => {
    const xml = textBodyToXml({ blocks: [para('T')], verticalAnchor: 'top' });
    expect(xml).toContain('anchor="t"');
  });

  it('emits paragraph alignment', () => {
    const block: Block = {
      id: 'b',
      type: 'paragraph',
      inlines: [{ text: 'A', style: {} }],
      style: { ...DEFAULT_BLOCK_STYLE, alignment: 'center' },
    };
    const xml = textBodyToXml({ blocks: [block] });
    expect(xml).toContain('algn="ctr"');
  });

  it('emits spcBef/spcAft from top/bottom margins (px → spcPts)', () => {
    const block: Block = {
      id: 'b',
      type: 'paragraph',
      inlines: [{ text: 'A', style: {} }],
      // 8 px → 6pt (val 600); 21.333 px → 16pt (val 1600).
      style: { ...DEFAULT_BLOCK_STYLE, marginTop: 8, marginBottom: 21.3333 },
    };
    const xml = textBodyToXml({ blocks: [block] });
    expect(xml).toContain('<a:spcBef><a:spcPts val="600"/></a:spcBef>');
    expect(xml).toContain('<a:spcAft><a:spcPts val="1600"/></a:spcAft>');
  });

  it('omits spcBef/spcAft when margins are zero', () => {
    const block: Block = {
      id: 'b',
      type: 'paragraph',
      inlines: [{ text: 'A', style: {} }],
      style: { ...DEFAULT_BLOCK_STYLE, marginTop: 0, marginBottom: 0 },
    };
    const xml = textBodyToXml({ blocks: [block] });
    expect(xml).not.toContain('<a:spcBef>');
    expect(xml).not.toContain('<a:spcAft>');
  });

  it('exports a soft break (\\n) as <a:br>, not a literal newline', () => {
    // A literal newline in <a:t> is collapsed by PowerPoint as insignificant
    // whitespace, dropping the break; it must round-trip through <a:br>.
    const block: Block = {
      id: 'b',
      type: 'paragraph',
      inlines: [
        { text: 'line1', style: { fontSize: 8 } },
        { text: '\n', style: { fontSize: 8 } },
        { text: 'line2', style: { fontSize: 8 } },
      ],
      style: { ...DEFAULT_BLOCK_STYLE },
    };
    const xml = textBodyToXml({ blocks: [block] });
    expect(xml).toContain('<a:br><a:rPr sz="800"></a:rPr></a:br>');
    expect(xml).toContain('<a:t>line1</a:t>');
    expect(xml).toContain('<a:t>line2</a:t>');
    expect(xml).not.toContain('<a:t>\n</a:t>');
  });

  it('round-trips a blank-line font size through export → re-import', () => {
    // Blank paragraph sized at 8pt (as an empty run) must survive a full
    // export → import cycle without collapsing to the docs default.
    const block: Block = {
      id: 'b',
      type: 'paragraph',
      inlines: [{ text: '', style: { fontSize: 8 } }],
      style: { ...DEFAULT_BLOCK_STYLE },
    };
    const xml = textBodyToXml({ blocks: [block] }, 'p:txBody');
    const el = parseXml(
      `<root xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ` +
        `xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">${xml}</root>`,
    ).documentElement.firstElementChild!;
    const reimported = parseTextBody(el, { report: new ImportReport() });
    expect(reimported[0].inlines[0].style.fontSize).toBe(8);
  });

  it('emits ordered list bullet', () => {
    const block: Block = {
      id: 'b',
      type: 'list-item',
      inlines: [{ text: 'I', style: {} }],
      style: { ...DEFAULT_BLOCK_STYLE },
      listKind: 'ordered',
      listLevel: 1,
    };
    const xml = textBodyToXml({ blocks: [block] });
    expect(xml).toContain('<a:buAutoNum type="arabicPeriod"/>');
    expect(xml).toContain('lvl="1"');
  });

  it('emits unordered list bullet', () => {
    const block: Block = {
      id: 'b',
      type: 'list-item',
      inlines: [{ text: 'U', style: {} }],
      style: { ...DEFAULT_BLOCK_STYLE },
      listKind: 'unordered',
    };
    const xml = textBodyToXml({ blocks: [block] });
    expect(xml).toContain('<a:buChar char="•"/>');
  });

  it('falls back to black for an unknown role string (no val="undefined")', () => {
    // StoredColor.role is open (string), so an out-of-set value can arrive
    // at runtime. Verify the bridge emits a valid srgbClr instead of the
    // broken <a:schemeClr val="undefined"/> that the old `c as any` path
    // would have produced.
    const unknownColor = { kind: 'role', role: 'somethingUnknown' } as Parameters<typeof textBodyToXml>[0]['blocks'][0]['inlines'][0]['style']['color'];
    const xml = textBodyToXml({ blocks: [para('X', { color: unknownColor })] });
    expect(xml).not.toContain('val="undefined"');
    expect(xml).toContain('<a:srgbClr val="000000"/>');
  });

  it('does not emit hlinkClick when no resolver is supplied', () => {
    // Callers with no `.rels` part (e.g. notes) omit the resolver; the href
    // stays in the model but no <a:hlinkClick> node is written (an empty
    // r:id="" would produce an invalid relationship reference).
    const xml = textBodyToXml({ blocks: [para('Link', { href: 'https://example.com' })] });
    expect(xml).not.toContain('hlinkClick');
  });

  it('emits hlinkClick with the resolved rId when a resolver is supplied', () => {
    const seen: string[] = [];
    const resolve = (href: string) => {
      seen.push(href);
      return 'rId7';
    };
    const xml = textBodyToXml(
      { blocks: [para('Link', { href: 'https://example.com/a?x=1&y=2' })] },
      'a:txBody',
      resolve,
    );
    expect(xml).toContain('<a:hlinkClick r:id="rId7"/>');
    expect(seen).toEqual(['https://example.com/a?x=1&y=2']);
    // hlinkClick must follow the typeface children per OOXML child order.
    const xml2 = textBodyToXml(
      { blocks: [para('L', { href: 'https://e.com', fontFamily: 'Arial' })] },
      'a:txBody',
      () => 'rId3',
    );
    expect(xml2.indexOf('<a:latin')).toBeLessThan(xml2.indexOf('<a:hlinkClick'));
  });

  it('drops executable/local href schemes even when a resolver is supplied', () => {
    const resolve = () => 'rIdX';
    for (const href of [
      'javascript:alert(1)',
      'data:text/html,x',
      'vbscript:x',
      'file:///etc',
    ]) {
      const xml = textBodyToXml({ blocks: [para('X', { href })] }, 'a:txBody', resolve);
      expect(xml).not.toContain('hlinkClick');
    }
  });

  it('exports non-web external schemes (tel/sms/ftp) as hyperlinks', () => {
    const resolve = () => 'rIdT';
    for (const href of ['tel:+15551234', 'sms:+15551234', 'ftp://host/f']) {
      const xml = textBodyToXml({ blocks: [para('X', { href })] }, 'a:txBody', resolve);
      expect(xml).toContain('<a:hlinkClick r:id="rIdT"/>');
    }
  });

  it('drops scheme-less/relative hrefs (would be a broken external rel)', () => {
    const resolve = () => 'rIdR';
    for (const href of ['www.example.com', '#slide2', '/local/path']) {
      const xml = textBodyToXml({ blocks: [para('X', { href })] }, 'a:txBody', resolve);
      expect(xml).not.toContain('hlinkClick');
    }
  });
});
