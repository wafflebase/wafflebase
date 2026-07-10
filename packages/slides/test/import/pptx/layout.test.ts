// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { parseLayout } from '../../../src/import/pptx/layout';
import { ImportReport } from '../../../src/import/pptx/report';

function layoutXml(type: string): string {
  return `<?xml version="1.0"?>
<p:sldLayout xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
             xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" type="${type}">
  <p:cSld name="Layout"><p:spTree/></p:cSld>
</p:sldLayout>`;
}

describe('parseLayout', () => {
  it('maps the four types used by the benchmark deck', async () => {
    const r = new ImportReport();
    expect((await parseLayout(layoutXml('tx'), 'l1', r)).layout.id).toBe('title-body');
    expect((await parseLayout(layoutXml('secHead'), 'l2', r)).layout.id).toBe('section-header');
    expect((await parseLayout(layoutXml('body'), 'l3', r)).layout.id).toBe('one-column-text');
    expect((await parseLayout(layoutXml('title'), 'l4', r)).layout.id).toBe('title-slide');
    expect(r.unknownLayoutTypes).toBe(0);
  });

  it('falls back to title-body and counts unknown types', async () => {
    const r = new ImportReport();
    const out = await parseLayout(layoutXml('mediaText'), 'lx', r);
    expect(out.layout.id).toBe('title-body');
    expect(r.unknownLayoutTypes).toBe(1);
  });

  it('preserves the OOXML part name for later rels resolution', async () => {
    const r = new ImportReport();
    const out = await parseLayout(layoutXml('blank'), 'ppt/slideLayouts/slideLayout11.xml', r);
    expect(out.ooxmlPartName).toBe('ppt/slideLayouts/slideLayout11.xml');
    expect(out.layout.id).toBe('blank');
    expect(out.placeholderSizes.size).toBe(0);
    expect(out.background).toBeUndefined();
  });

  it('extracts placeholder default font sizes from <a:lstStyle><a:lvl1pPr><a:defRPr sz>', async () => {
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
    const out = await parseLayout(xml, 'ppt/slideLayouts/slideLayout1.xml', new ImportReport());
    // `ctrTitle` is normalized to `title` so a slide-level `<p:ph type="title"/>`
    // (the common Google-Slides export) inherits this layout default.
    expect(out.placeholderSizes.get('title:0')).toBe(52);
    expect(out.placeholderSizes.get('subTitle:1')).toBe(24);
  });

  it('parses a layout <p:bg> blipFill into layout.background.image', async () => {
    // slideLayout1.xml of the Naver deck references image6.png (BytePlus
    // logo + bottom gradient) as its background. Slide 1 has no <p:bg> of
    // its own, so this layout background is what must render.
    const xml = `<?xml version="1.0"?>
<p:sldLayout xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
             xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
             xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" type="title">
  <p:cSld name="Title Slide">
    <p:bg><p:bgPr>
      <a:blipFill dpi="0" rotWithShape="1">
        <a:blip r:embed="rId2"/>
        <a:stretch><a:fillRect/></a:stretch>
      </a:blipFill>
      <a:effectLst/>
    </p:bgPr></p:bg>
    <p:spTree/>
  </p:cSld>
</p:sldLayout>`;
    const uploaded: string[] = [];
    const imageCtx = {
      archive: {
        readText: async () => undefined,
        readBytes: async () => new Uint8Array([1, 2, 3]),
      },
      slidePartPath: 'ppt/slideLayouts/slideLayout1.xml',
      rels: new Map([
        ['rId2', { type: 'image', target: '../media/image6.png' }],
      ]),
      uploadImage: async (_bytes: Uint8Array, mime: string) => {
        uploaded.push(mime);
        return 'blob:image6';
      },
      scale: { x: (v: number) => v, y: (v: number) => v },
      report: new ImportReport(),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
    const out = await parseLayout(xml, 'ppt/slideLayouts/slideLayout1.xml', new ImportReport(), {
      imageCtx,
      clrMap: new Map(),
    });
    expect(out.background?.image?.src).toBe('blob:image6');
    expect(uploaded).toEqual(['image/png']);
  });

  it('extracts placeholder frames (scaled) when a bgCtx with scale is provided', async () => {
    const xml = `<?xml version="1.0"?>
<p:sldLayout xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
             xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" type="title">
  <p:cSld name="Title Slide"><p:spTree>
    <p:sp>
      <p:nvSpPr><p:cNvPr id="3" name="Content Placeholder 2"/><p:cNvSpPr/>
        <p:nvPr><p:ph sz="quarter" idx="10"/></p:nvPr></p:nvSpPr>
      <p:spPr><a:xfrm><a:off x="1000" y="2000"/><a:ext cx="4000" cy="500"/></a:xfrm></p:spPr>
      <p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t/></a:r></a:p></p:txBody>
    </p:sp>
  </p:spTree></p:cSld>
</p:sldLayout>`;
    const out = await parseLayout(xml, 'l', new ImportReport(), {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      imageCtx: { scale: { sx: 2, sy: 3 } } as any,
      clrMap: new Map(),
    });
    expect(out.placeholderFrames.get('body:10')).toMatchObject({
      x: 2000,
      y: 6000,
      w: 8000,
      h: 1500,
    });
  });

  it('yields empty placeholderFrames when no bgCtx (no scale) is provided', async () => {
    const out = await parseLayout(layoutXml('title'), 'l', new ImportReport());
    expect(out.placeholderFrames.size).toBe(0);
  });

  it('leaves layout.background undefined for a <p:bgRef> style-matrix reference', async () => {
    const xml = `<?xml version="1.0"?>
<p:sldLayout xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
             xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" type="title">
  <p:cSld name="Title Slide">
    <p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg>
    <p:spTree/>
  </p:cSld>
</p:sldLayout>`;
    const out = await parseLayout(xml, 'l', new ImportReport(), {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      imageCtx: {} as any,
      clrMap: new Map(),
    });
    expect(out.background).toBeUndefined();
  });
});
