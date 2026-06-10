// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { parseTextBody, detectAutofitMode, detectVerticalAnchor } from '../../../src/import/pptx/text';
import { ImportReport } from '../../../src/import/pptx/report';
import { parseXml } from '../../../src/import/pptx/xml';
import type { PptxRel } from '../../../src/import/pptx/rels';
import { parseSpTree } from '../../../src/import/pptx/shape';
import type { SlideParseContext } from '../../../src/import/pptx/shape';
import type { TextElement } from '../../../src/model/element';

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

  it('leaves fontFamily unset on a Hangul run with no typeface override', () => {
    // The importer no longer injects 'Noto Sans KR' for Hangul runs; the
    // renderer's `resolveFontFamily` splices a Korean-capable family into
    // every non-monospace fallback chain, so the theme default applies and
    // Hangul still renders properly via the CSS cascade.
    const t = txBody(`<a:txBody><a:bodyPr/><a:p><a:r><a:t>안녕</a:t></a:r></a:p></a:txBody>`);
    const inline = parseTextBody(t, { report: new ImportReport() })[0].inlines[0];
    expect(inline.style.fontFamily).toBeUndefined();
  });

  it('preserves an explicit Latin typeface even on Hangul runs', () => {
    // Previously the Korean-fallback guard could shadow whatever face was set;
    // now the importer preserves the original face verbatim and the renderer
    // appends the Korean fallback.
    const t = txBody(`<a:txBody><a:bodyPr/><a:p><a:r><a:rPr><a:latin typeface="Arial"/></a:rPr><a:t>안녕</a:t></a:r></a:p></a:txBody>`);
    const inline = parseTextBody(t, { report: new ImportReport() })[0].inlines[0];
    expect(inline.style.fontFamily).toBe('Arial');
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

  it('reads <a:buFont>/<a:buSzPts>/<a:buClr> into block.marker for list-items', () => {
    const t = txBody(`<a:txBody>
      <a:bodyPr/>
      <a:p>
        <a:pPr lvl="0">
          <a:buClr><a:srgbClr val="FF9900"/></a:buClr>
          <a:buFont typeface="Arial"/>
          <a:buSzPts val="1800"/>
          <a:buChar char="●"/>
        </a:pPr>
        <a:r><a:t>Oct, 2022: Yorkie, 캐즘 뛰어넘기</a:t></a:r>
      </a:p>
    </a:txBody>`);
    const blocks = parseTextBody(t, { report: new ImportReport() });
    expect(blocks[0].type).toBe('list-item');
    expect(blocks[0].marker).toEqual({
      fontFamily: 'Arial',
      fontSize: 18,
      color: { kind: 'srgb', value: '#FF9900' },
    });
  });

  it('does NOT attach marker to non-list paragraphs', () => {
    // PPTX paragraphs can carry bullet style attributes alongside `<a:buNone/>`
    // (e.g. layout-inherited defaults). The marker is meaningless for
    // non-list paragraphs and would just bloat persisted documents.
    const t = txBody(`<a:txBody>
      <a:bodyPr/>
      <a:p>
        <a:pPr>
          <a:buFont typeface="Arial"/>
          <a:buSzPts val="1800"/>
          <a:buNone/>
        </a:pPr>
        <a:r><a:t>plain</a:t></a:r>
      </a:p>
    </a:txBody>`);
    const blocks = parseTextBody(t, { report: new ImportReport() });
    expect(blocks[0].type).toBe('paragraph');
    expect(blocks[0].marker).toBeUndefined();
  });

  it('resolves <a:buClr><a:schemeClr> through the clrMap', () => {
    const t = txBody(`<a:txBody>
      <a:bodyPr/>
      <a:p>
        <a:pPr lvl="0">
          <a:buClr><a:schemeClr val="accent1"/></a:buClr>
          <a:buChar char="●"/>
        </a:pPr>
        <a:r><a:t>x</a:t></a:r>
      </a:p>
    </a:txBody>`);
    const blocks = parseTextBody(t, {
      report: new ImportReport(),
      clrMap: new Map(),
    });
    expect(blocks[0].marker?.color).toEqual({ kind: 'role', role: 'accent1' });
  });

  it('inherits master <p:txStyles> marker axes the paragraph leaves blank', () => {
    // Mirrors the real-world "Yorkie 캐즘" deck: the paragraph carries
    // only `<a:buSzPts>` / `<a:buChar>`, while `<a:buFont>` lives in the
    // master's `<p:bodyStyle>`. The merged marker should pick up Arial
    // from the master while keeping the paragraph's 18 pt size.
    const t = txBody(`<a:txBody>
      <a:bodyPr/>
      <a:p>
        <a:pPr lvl="0">
          <a:buSzPts val="1800"/>
          <a:buChar char="●"/>
        </a:pPr>
        <a:r><a:t>April, 2019: </a:t></a:r>
      </a:p>
    </a:txBody>`);
    const markerDefaults = new Map([
      [0, { fontFamily: 'Arial', color: { kind: 'srgb' as const, value: '#000000' } }],
    ]);
    const blocks = parseTextBody(t, {
      report: new ImportReport(),
      markerDefaults,
    });
    expect(blocks[0].marker).toEqual({
      fontFamily: 'Arial',
      fontSize: 18,
      color: { kind: 'srgb', value: '#000000' },
    });
  });

  it('does not return the shared markerDefaults reference (no mutation leak)', () => {
    // Regression: `mergeMarkers` previously returned its `base` argument
    // unchanged when no paragraph overrides existed, so two paragraphs
    // resolving to the same master default would share the same
    // `Block.marker` object. A downstream mutation (e.g. clearFormatting
    // or theme remap) on one paragraph would silently corrupt every
    // other list item that inherits the same level default.
    const t = txBody(`<a:txBody>
      <a:bodyPr/>
      <a:p>
        <a:pPr lvl="0">
          <a:buSzPts val="1800"/>
          <a:buChar char="●"/>
        </a:pPr>
        <a:r><a:t>April</a:t></a:r>
      </a:p>
      <a:p>
        <a:pPr lvl="0">
          <a:buSzPts val="1800"/>
          <a:buChar char="●"/>
        </a:pPr>
        <a:r><a:t>May</a:t></a:r>
      </a:p>
    </a:txBody>`);
    const sharedDefault = { fontFamily: 'Arial' };
    const markerDefaults = new Map([[0, sharedDefault]]);
    const blocks = parseTextBody(t, {
      report: new ImportReport(),
      markerDefaults,
    });
    expect(blocks[0].marker).not.toBe(sharedDefault);
    expect(blocks[1].marker).not.toBe(sharedDefault);
    expect(blocks[0].marker).not.toBe(blocks[1].marker);
    // Mutating block 0's marker must not bleed into the default or block 1.
    blocks[0].marker!.fontFamily = 'Mutated';
    expect(sharedDefault.fontFamily).toBe('Arial');
    expect(blocks[1].marker?.fontFamily).toBe('Arial');
  });

  it('paragraph axis overrides the master default when both are present', () => {
    const t = txBody(`<a:txBody>
      <a:bodyPr/>
      <a:p>
        <a:pPr lvl="0">
          <a:buClr><a:srgbClr val="FF9900"/></a:buClr>
          <a:buSzPts val="1800"/>
          <a:buChar char="●"/>
        </a:pPr>
        <a:r><a:t>Oct, 2022: Yorkie, 캐즘 뛰어넘기</a:t></a:r>
      </a:p>
    </a:txBody>`);
    const markerDefaults = new Map([
      [0, { fontFamily: 'Arial', color: { kind: 'srgb' as const, value: '#000000' } }],
    ]);
    const blocks = parseTextBody(t, {
      report: new ImportReport(),
      markerDefaults,
    });
    expect(blocks[0].marker).toEqual({
      fontFamily: 'Arial',
      fontSize: 18,
      color: { kind: 'srgb', value: '#FF9900' },
    });
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

describe('detectVerticalAnchor', () => {
  it('returns "bottom" for anchor="b"', () => {
    const t = txBody(`<a:txBody><a:bodyPr anchor="b"/></a:txBody>`);
    expect(detectVerticalAnchor(t)).toBe('bottom');
  });

  it('returns "middle" for anchor="ctr"', () => {
    const t = txBody(`<a:txBody><a:bodyPr anchor="ctr"/></a:txBody>`);
    expect(detectVerticalAnchor(t)).toBe('middle');
  });

  it('returns "top" for anchor="t"', () => {
    const t = txBody(`<a:txBody><a:bodyPr anchor="t"/></a:txBody>`);
    expect(detectVerticalAnchor(t)).toBe('top');
  });

  it('returns undefined when bodyPr is absent', () => {
    const t = txBody(`<a:txBody><a:p><a:r><a:t>x</a:t></a:r></a:p></a:txBody>`);
    expect(detectVerticalAnchor(t)).toBeUndefined();
  });

  it('returns undefined when anchor attr is missing', () => {
    const t = txBody(`<a:txBody><a:bodyPr/></a:txBody>`);
    expect(detectVerticalAnchor(t)).toBeUndefined();
  });

  it('returns undefined when anchor attr is an empty string', () => {
    const t = txBody(`<a:txBody><a:bodyPr anchor=""/></a:txBody>`);
    expect(detectVerticalAnchor(t)).toBeUndefined();
  });

  it('returns "top" for unsupported anchor values (just, dist)', () => {
    const just = txBody(`<a:txBody><a:bodyPr anchor="just"/></a:txBody>`);
    expect(detectVerticalAnchor(just)).toBe('top');
    const dist = txBody(`<a:txBody><a:bodyPr anchor="dist"/></a:txBody>`);
    expect(detectVerticalAnchor(dist)).toBe('top');
  });
});

describe('PPTX import — verticalAnchor wiring', () => {
  function makeCtx(): SlideParseContext {
    return {
      archive: { readBytes: async () => undefined, readText: async () => undefined },
      slidePartPath: 'ppt/slides/slide1.xml',
      rels: new Map(),
      scale: { kx: 1 / 9525, ky: 1 / 9525 },
      report: new ImportReport(),
      idMap: new Map(),
      shapeKindByPptxId: new Map(),
      placeholderSizes: new Map(),
      clrMap: {},
    } as unknown as SlideParseContext;
  }

  it('writes verticalAnchor="bottom" for anchor="b" placeholders', async () => {
    const spTree = parseXml(`<p:spTree xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
      <p:sp>
        <p:nvSpPr><p:cNvPr id="1" name="Title 1"/><p:cNvSpPr txBox="1"/><p:nvPr><p:ph type="ctrTitle"/></p:nvPr></p:nvSpPr>
        <p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="9144000" cy="2052600"/></a:xfrm><a:prstGeom prst="rect"/></p:spPr>
        <p:txBody>
          <a:bodyPr anchor="b"/>
          <a:p><a:r><a:t>Title</a:t></a:r></a:p>
        </p:txBody>
      </p:sp>
    </p:spTree>`).documentElement;
    const elements = await parseSpTree(spTree, makeCtx());
    expect(elements).toHaveLength(1);
    const txt = elements[0] as TextElement;
    expect(txt.type).toBe('text');
    expect(txt.data.verticalAnchor).toBe('bottom');
  });

  it('omits verticalAnchor when bodyPr has no anchor attr', async () => {
    const spTree = parseXml(`<p:spTree xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
      <p:sp>
        <p:nvSpPr><p:cNvPr id="2" name="Body"/><p:cNvSpPr txBox="1"/><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr>
        <p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="9144000" cy="2052600"/></a:xfrm><a:prstGeom prst="rect"/></p:spPr>
        <p:txBody><a:bodyPr/><a:p><a:r><a:t>Body</a:t></a:r></a:p></p:txBody>
      </p:sp>
    </p:spTree>`).documentElement;
    const elements = await parseSpTree(spTree, makeCtx());
    const txt = elements[0] as TextElement;
    expect(txt.data.verticalAnchor).toBeUndefined();
  });
});
