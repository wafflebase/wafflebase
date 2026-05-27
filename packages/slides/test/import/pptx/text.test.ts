// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { parseTextBody, detectAutofitMode } from '../../../src/import/pptx/text';
import { ImportReport } from '../../../src/import/pptx/report';
import { parseXml } from '../../../src/import/pptx/xml';
import type { PptxRel } from '../../../src/import/pptx/rels';

function txBody(xml: string): Element {
  return parseXml(
    `<root xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">${xml}</root>`,
  ).documentElement.firstElementChild!;
}

describe('parseTextBody — runs', () => {
  it('captures bold, underline, font size, font family, color', () => {
    const t = txBody(`<a:txBody>
      <a:bodyPr/>
      <a:p>
        <a:r>
          <a:rPr b="1" u="sng" sz="1800"><a:latin typeface="Roboto"/><a:solidFill><a:srgbClr val="FF9900"/></a:solidFill></a:rPr>
          <a:t>Hi</a:t>
        </a:r>
      </a:p>
    </a:txBody>`);
    const ctx = { report: new ImportReport() };
    const blocks = parseTextBody(t, ctx);
    expect(blocks).toHaveLength(1);
    const inline = blocks[0].inlines[0];
    expect(inline.text).toBe('Hi');
    expect(inline.style.bold).toBe(true);
    expect(inline.style.underline).toBe(true);
    expect(inline.style.fontSize).toBe(18);
    expect(inline.style.fontFamily).toBe('Roboto');
    expect(inline.style.color).toEqual({ kind: 'srgb', value: '#FF9900' });
  });

  it('captures <a:highlight> as backgroundColor', () => {
    const t = txBody(`<a:txBody>
      <a:bodyPr/>
      <a:p><a:r><a:rPr sz="800"><a:highlight><a:schemeClr val="lt1"/></a:highlight></a:rPr><a:t>marker</a:t></a:r></a:p>
    </a:txBody>`);
    const inline = parseTextBody(t, { report: new ImportReport() })[0].inlines[0];
    expect(inline.style.backgroundColor).toEqual({ kind: 'role', role: 'background' });
  });

  it('resolves hyperlink rids via the per-slide rels map', () => {
    const rels = new Map<string, PptxRel>([
      ['rId7', { type: 'hyperlink', target: 'https://yorkie.dev/', external: true }],
    ]);
    const t = txBody(`<a:txBody>
      <a:bodyPr/>
      <a:p><a:r><a:rPr><a:hlinkClick xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:id="rId7"/></a:rPr><a:t>yorkie</a:t></a:r></a:p>
    </a:txBody>`);
    const inline = parseTextBody(t, { rels, report: new ImportReport() })[0].inlines[0];
    expect(inline.style.href).toBe('https://yorkie.dev/');
  });

  it('drops unsafe schemes and internal-slide rels', () => {
    const xssTxt = txBody(`<a:txBody><a:bodyPr/><a:p><a:r>
      <a:rPr><a:hlinkClick xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:id="rId1"/></a:rPr>
      <a:t>click</a:t>
    </a:r></a:p></a:txBody>`);
    const internalTxt = txBody(`<a:txBody><a:bodyPr/><a:p><a:r>
      <a:rPr><a:hlinkClick xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:id="rId2"/></a:rPr>
      <a:t>jump</a:t>
    </a:r></a:p></a:txBody>`);
    const rels = new Map<string, PptxRel>([
      ['rId1', { type: 'hyperlink', target: 'javascript:alert(1)', external: true }],
      ['rId2', { type: 'slide', target: 'slide3.xml', external: false }],
    ]);
    expect(
      parseTextBody(xssTxt, { rels, report: new ImportReport() })[0].inlines[0].style.href,
    ).toBeUndefined();
    expect(
      parseTextBody(internalTxt, { rels, report: new ImportReport() })[0].inlines[0].style.href,
    ).toBeUndefined();
  });

  it('falls back to Noto Sans KR when typeface is missing but Hangul is present', () => {
    const t = txBody(`<a:txBody><a:bodyPr/><a:p><a:r><a:t>안녕</a:t></a:r></a:p></a:txBody>`);
    const inline = parseTextBody(t, { report: new ImportReport() })[0].inlines[0];
    expect(inline.style.fontFamily).toBe('Noto Sans KR');
  });

  it('does not override an explicit Korean-capable typeface', () => {
    const t = txBody(`<a:txBody><a:bodyPr/><a:p><a:r><a:rPr><a:latin typeface="Nanum Gothic"/></a:rPr><a:t>안녕</a:t></a:r></a:p></a:txBody>`);
    const inline = parseTextBody(t, { report: new ImportReport() })[0].inlines[0];
    expect(inline.style.fontFamily).toBe('Nanum Gothic');
  });
});

describe('parseTextBody — paragraphs', () => {
  it('captures alignment + line spacing + indent', () => {
    const t = txBody(`<a:txBody>
      <a:bodyPr/>
      <a:p>
        <a:pPr algn="ctr" marL="457200" indent="-457200">
          <a:lnSpc><a:spcPct val="120000"/></a:lnSpc>
          <a:buNone/>
        </a:pPr>
        <a:r><a:t>x</a:t></a:r>
      </a:p>
    </a:txBody>`);
    const block = parseTextBody(t, { report: new ImportReport() })[0];
    expect(block.type).toBe('paragraph');
    expect(block.style.alignment).toBe('center');
    expect(block.style.lineHeight).toBeCloseTo(1.2, 6);
    expect(block.style.marginLeft).toBe(48); // 457200 / 9525
    expect(block.style.textIndent).toBe(-48);
  });

  it('classifies bulleted and numbered paragraphs as list-items', () => {
    const t = txBody(`<a:txBody>
      <a:bodyPr/>
      <a:p><a:pPr lvl="0"><a:buChar char="•"/></a:pPr><a:r><a:t>a</a:t></a:r></a:p>
      <a:p><a:pPr lvl="1"><a:buAutoNum type="arabicPeriod"/></a:pPr><a:r><a:t>b</a:t></a:r></a:p>
      <a:p><a:pPr><a:buNone/></a:pPr><a:r><a:t>c</a:t></a:r></a:p>
    </a:txBody>`);
    const blocks = parseTextBody(t, { report: new ImportReport() });
    expect(blocks[0].type).toBe('list-item');
    expect(blocks[0].listKind).toBe('unordered');
    expect(blocks[0].listLevel).toBe(0);
    expect(blocks[1].type).toBe('list-item');
    expect(blocks[1].listKind).toBe('ordered');
    expect(blocks[1].listLevel).toBe(1);
    expect(blocks[2].type).toBe('paragraph');
  });

  it('preserves empty paragraphs with placeholder inline so layout never NaNs', () => {
    const t = txBody(`<a:txBody><a:bodyPr/><a:p/></a:txBody>`);
    const blocks = parseTextBody(t, { report: new ImportReport() });
    expect(blocks).toHaveLength(1);
    expect(blocks[0].inlines).toHaveLength(1);
    expect(blocks[0].inlines[0].text).toBe('');
  });

  it('lifts <a:br> into a soft line break in the same block', () => {
    const t = txBody(`<a:txBody><a:bodyPr/><a:p>
      <a:r><a:rPr sz="1000"/><a:t>line1</a:t></a:r>
      <a:br/>
      <a:r><a:rPr sz="1000"/><a:t>line2</a:t></a:r>
    </a:p></a:txBody>`);
    const blocks = parseTextBody(t, { report: new ImportReport() });
    expect(blocks).toHaveLength(1);
    expect(blocks[0].inlines.map((i) => i.text)).toEqual(['line1', '\n', 'line2']);
  });
});

describe('detectAutofitMode', () => {
  it('maps <a:normAutofit/> to shrink', () => {
    expect(detectAutofitMode(txBody('<a:txBody><a:bodyPr><a:normAutofit/></a:bodyPr><a:p/></a:txBody>'))).toBe('shrink');
  });
  it('maps <a:spAutoFit/> to grow', () => {
    expect(detectAutofitMode(txBody('<a:txBody><a:bodyPr><a:spAutoFit/></a:bodyPr><a:p/></a:txBody>'))).toBe('grow');
  });
  it('maps <a:noAutofit/> to none', () => {
    expect(detectAutofitMode(txBody('<a:txBody><a:bodyPr><a:noAutofit/></a:bodyPr><a:p/></a:txBody>'))).toBe('none');
  });
  it('defaults to none when bodyPr has no autofit child', () => {
    expect(detectAutofitMode(txBody('<a:txBody><a:bodyPr/><a:p/></a:txBody>'))).toBe('none');
  });
  it('defaults to none when there is no bodyPr', () => {
    expect(detectAutofitMode(txBody('<a:txBody><a:p/></a:txBody>'))).toBe('none');
  });
});

describe('parseTextBody — normAutofit pre-scale', () => {
  it('multiplies fontSize by fontScale/100000 and bumps the report', () => {
    const t = txBody(`<a:txBody>
      <a:bodyPr><a:normAutofit fontScale="90000"/></a:bodyPr>
      <a:p><a:r><a:rPr sz="2000"/><a:t>big</a:t></a:r></a:p>
    </a:txBody>`);
    const report = new ImportReport();
    const blocks = parseTextBody(t, { report });
    expect(blocks[0].inlines[0].style.fontSize).toBeCloseTo(18, 6); // 20pt * 0.9
    expect(report.textBoxesPreScaled).toBe(1);
  });

  it('does NOT bump the report when fontScale is 100000 (no shrink)', () => {
    const t = txBody(`<a:txBody>
      <a:bodyPr><a:normAutofit fontScale="100000"/></a:bodyPr>
      <a:p><a:r><a:rPr sz="2000"/><a:t>same</a:t></a:r></a:p>
    </a:txBody>`);
    const report = new ImportReport();
    parseTextBody(t, { report });
    expect(report.textBoxesPreScaled).toBe(0);
  });
});
