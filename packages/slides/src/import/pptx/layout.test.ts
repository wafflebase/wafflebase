// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { parseLayout } from './layout';
import { ImportReport } from './report';

function layoutXml(type: string): string {
  return `<?xml version="1.0"?>
<p:sldLayout xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
             xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" type="${type}">
  <p:cSld name="Layout"><p:spTree/></p:cSld>
</p:sldLayout>`;
}

describe('parseLayout', () => {
  it('maps the four types used by the benchmark deck', () => {
    const r = new ImportReport();
    expect(parseLayout(layoutXml('tx'), 'l1', r).layout.id).toBe('title-body');
    expect(parseLayout(layoutXml('secHead'), 'l2', r).layout.id).toBe('section-header');
    expect(parseLayout(layoutXml('body'), 'l3', r).layout.id).toBe('one-column-text');
    expect(parseLayout(layoutXml('title'), 'l4', r).layout.id).toBe('title-slide');
    expect(r.unknownLayoutTypes).toBe(0);
  });

  it('falls back to title-body and counts unknown types', () => {
    const r = new ImportReport();
    const out = parseLayout(layoutXml('mediaText'), 'lx', r);
    expect(out.layout.id).toBe('title-body');
    expect(r.unknownLayoutTypes).toBe(1);
  });

  it('preserves the OOXML part name for later rels resolution', () => {
    const r = new ImportReport();
    const out = parseLayout(layoutXml('blank'), 'ppt/slideLayouts/slideLayout11.xml', r);
    expect(out.ooxmlPartName).toBe('ppt/slideLayouts/slideLayout11.xml');
    expect(out.layout.id).toBe('blank');
    expect(out.placeholderSizes.size).toBe(0);
  });

  it('extracts placeholder default font sizes from <a:lstStyle><a:lvl1pPr><a:defRPr sz>', () => {
    // Mirrors the benchmark deck's slideLayout1.xml, where the ctrTitle
    // placeholder carries sz="5200" (52pt) as its default. Without
    // reading this, slide-level runs with no explicit sz collapse to
    // the docs renderer's 11pt fallback.
    const xml = `<?xml version="1.0"?>
<p:sldLayout xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
             xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" type="title">
  <p:cSld name="Title Slide">
    <p:spTree>
      <p:sp>
        <p:nvSpPr><p:cNvPr id="2" name="Title 1"/><p:cNvSpPr/><p:nvPr><p:ph type="ctrTitle"/></p:nvPr></p:nvSpPr>
        <p:spPr/>
        <p:txBody>
          <a:bodyPr/>
          <a:lstStyle><a:lvl1pPr><a:defRPr sz="5200"/></a:lvl1pPr></a:lstStyle>
          <a:p><a:r><a:t/></a:r></a:p>
        </p:txBody>
      </p:sp>
      <p:sp>
        <p:nvSpPr><p:cNvPr id="3" name="Subtitle 2"/><p:cNvSpPr/><p:nvPr><p:ph idx="1" type="subTitle"/></p:nvPr></p:nvSpPr>
        <p:spPr/>
        <p:txBody>
          <a:bodyPr/>
          <a:lstStyle><a:lvl1pPr><a:defRPr sz="2400"/></a:lvl1pPr></a:lstStyle>
          <a:p><a:r><a:t/></a:r></a:p>
        </p:txBody>
      </p:sp>
    </p:spTree>
  </p:cSld>
</p:sldLayout>`;
    const out = parseLayout(xml, 'ppt/slideLayouts/slideLayout1.xml', new ImportReport());
    expect(out.placeholderSizes.get('ctrTitle:0')).toBe(52);
    expect(out.placeholderSizes.get('subTitle:1')).toBe(24);
  });
});
