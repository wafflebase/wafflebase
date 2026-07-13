// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { parseSlide, parseSlideBackground } from '../../../src/import/pptx/slide';
import { ImportReport } from '../../../src/import/pptx/report';
import type { PptxArchive } from '../../../src/import/pptx/unzip';
import type { ImageParseContext } from '../../../src/import/pptx/image';
import { parseXml, descendant } from '../../../src/import/pptx/xml';

/**
 * Build a `PptxArchive` mock backed by an in-memory file map. Only the
 * methods the importer actually calls are populated — `list()` is a
 * no-op because slide parsing doesn't walk the archive.
 */
function makeArchive(files: Record<string, string | Uint8Array>): PptxArchive {
  return {
    readText: async (path) => {
      const v = files[path];
      return typeof v === 'string' ? v : undefined;
    },
    readBytes: async (path) => {
      const v = files[path];
      if (v instanceof Uint8Array) return v;
      if (typeof v === 'string') return new TextEncoder().encode(v);
      return undefined;
    },
    list: () => [],
  };
}

const SLIDE_WITH_BLIPFILL = `<?xml version="1.0"?>
<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
       xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
       xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <p:cSld>
    <p:bg>
      <p:bgPr>
        <a:blipFill>
          <a:blip r:embed="rIdImg"><a:alphaModFix amt="80000"/></a:blip>
          <a:stretch><a:fillRect/></a:stretch>
        </a:blipFill>
      </p:bgPr>
    </p:bg>
    <p:spTree/>
  </p:cSld>
</p:sld>`;

const SLIDE_RELS = `<?xml version="1.0"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rIdImg" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image1.png"/>
</Relationships>`;

const SLIDE_BLIPFILL_NO_REL = `<?xml version="1.0"?>
<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
       xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
       xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <p:cSld>
    <p:bg>
      <p:bgPr>
        <a:blipFill>
          <a:blip r:embed="rIdMissing"/>
          <a:stretch><a:fillRect/></a:stretch>
        </a:blipFill>
      </p:bgPr>
    </p:bg>
    <p:spTree/>
  </p:cSld>
</p:sld>`;

const SLIDE_NO_BG = `<?xml version="1.0"?>
<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
       xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
       xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <p:cSld><p:spTree/></p:cSld>
</p:sld>`;

const SLIDE_LAYOUT_RELS = `<?xml version="1.0"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>
</Relationships>`;

describe('parseSlide — inherited layout background', () => {
  it('bakes the layout background image onto a slide with no own <p:bg>', async () => {
    // Mirrors the Naver deck: slide 1 has no <p:bg>; its layout
    // (slideLayout1) carries a blipFill gradient background image. PPTX
    // inheritance (slide → layout) must surface it on the slide.
    const archive = makeArchive({
      'ppt/slides/slide1.xml': SLIDE_NO_BG,
      'ppt/slides/_rels/slide1.xml.rels': SLIDE_LAYOUT_RELS,
    });
    const layoutMap = new Map([
      [
        'ppt/slideLayouts/slideLayout1.xml',
        {
          builtInId: 'title-body',
          placeholderSizes: new Map<string, number>(),
          background: {
            fill: { kind: 'role', role: 'background' } as const,
            image: { src: 'cdn://layout-gradient.png' },
          },
        },
      ],
    ]);

    const slide = await parseSlide({
      archive,
      partPath: 'ppt/slides/slide1.xml',
      layoutMap,
      uploadImage: async () => 'cdn://unused.png',
      scale: { sx: 1, sy: 1 },
      report: new ImportReport(),
      clrMap: new Map(),
    });

    expect(slide!.layoutId).toBe('title-body');
    expect(slide!.background.image).toEqual({ src: 'cdn://layout-gradient.png' });
    // Fill stays an inheritable role so theme changes still cascade.
    expect(slide!.background.fill).toEqual({ kind: 'role', role: 'background' });
  });

  it('inherits the layout placeholder frame when the slide placeholder omits <a:xfrm>', async () => {
    // Mirrors slide 1's "2026년 3월" content placeholder: `<p:ph idx="10"/>`
    // with an empty `<p:spPr/>`. Its bottom-left position lives only on the
    // layout placeholder, so without inheritance it collapses to (0,0).
    const slideXml = `<?xml version="1.0"?>
<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
       xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
       xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <p:cSld><p:spTree>
    <p:sp>
      <p:nvSpPr><p:cNvPr id="3" name="Content Placeholder 2"/><p:cNvSpPr/>
        <p:nvPr><p:ph sz="quarter" idx="10"/></p:nvPr></p:nvSpPr>
      <p:spPr/>
      <p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>2026년 3월</a:t></a:r></a:p></p:txBody>
    </p:sp>
  </p:spTree></p:cSld>
</p:sld>`;
    const archive = makeArchive({
      'ppt/slides/slide1.xml': slideXml,
      'ppt/slides/_rels/slide1.xml.rels': SLIDE_LAYOUT_RELS,
    });
    const layoutMap = new Map([
      [
        'ppt/slideLayouts/slideLayout1.xml',
        {
          builtInId: 'title-body',
          placeholderSizes: new Map<string, number>(),
          placeholderFrames: new Map([
            ['body:10', { x: 68, y: 982, w: 430, h: 49, rotation: 0 }],
          ]),
        },
      ],
    ]);

    const slide = await parseSlide({
      archive,
      partPath: 'ppt/slides/slide1.xml',
      layoutMap,
      scale: { sx: 1, sy: 1 },
      report: new ImportReport(),
      clrMap: new Map(),
    });

    expect(slide!.elements).toHaveLength(1);
    expect(slide!.elements[0].frame).toMatchObject({ x: 68, y: 982, w: 430, h: 49 });
  });

  it('inherits a title frame across the ctrTitle→title alias', async () => {
    // Layout stores its center title under `ctrTitle` → normalized key
    // `title:0`; a slide `<p:ph type="title"/>` must still find it.
    const slideXml = `<?xml version="1.0"?>
<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
       xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
       xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <p:cSld><p:spTree>
    <p:sp>
      <p:nvSpPr><p:cNvPr id="2" name="Title 1"/><p:cNvSpPr/>
        <p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr>
      <p:spPr/>
      <p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>Hi</a:t></a:r></a:p></p:txBody>
    </p:sp>
  </p:spTree></p:cSld>
</p:sld>`;
    const archive = makeArchive({
      'ppt/slides/slide1.xml': slideXml,
      'ppt/slides/_rels/slide1.xml.rels': SLIDE_LAYOUT_RELS,
    });
    const layoutMap = new Map([
      [
        'ppt/slideLayouts/slideLayout1.xml',
        {
          builtInId: 'title-slide',
          placeholderSizes: new Map<string, number>(),
          // Stored under the normalized key, as parseLayout would from ctrTitle.
          placeholderFrames: new Map([
            ['title:0', { x: 100, y: 200, w: 800, h: 300, rotation: 0 }],
          ]),
        },
      ],
    ]);

    const slide = await parseSlide({
      archive,
      partPath: 'ppt/slides/slide1.xml',
      layoutMap,
      scale: { sx: 1, sy: 1 },
      report: new ImportReport(),
      clrMap: new Map(),
    });

    expect(slide!.elements[0].frame).toMatchObject({ x: 100, y: 200, w: 800, h: 300 });
  });

  it('merges a partial (offset-only) slide xfrm with the layout extent', async () => {
    // A placeholder that overrides only its position, inheriting width/height
    // from the layout. Without the merge, parseXfrm yields w=0,h=0 (invisible).
    const slideXml = `<?xml version="1.0"?>
<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
       xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
       xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <p:cSld><p:spTree>
    <p:sp>
      <p:nvSpPr><p:cNvPr id="3" name="Content Placeholder 2"/><p:cNvSpPr/>
        <p:nvPr><p:ph sz="quarter" idx="10"/></p:nvPr></p:nvSpPr>
      <p:spPr><a:xfrm><a:off x="500" y="600"/></a:xfrm></p:spPr>
      <p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>x</a:t></a:r></a:p></p:txBody>
    </p:sp>
  </p:spTree></p:cSld>
</p:sld>`;
    const archive = makeArchive({
      'ppt/slides/slide1.xml': slideXml,
      'ppt/slides/_rels/slide1.xml.rels': SLIDE_LAYOUT_RELS,
    });
    const layoutMap = new Map([
      [
        'ppt/slideLayouts/slideLayout1.xml',
        {
          builtInId: 'title-body',
          placeholderSizes: new Map<string, number>(),
          placeholderFrames: new Map([
            ['body:10', { x: 68, y: 982, w: 430, h: 49, rotation: 0 }],
          ]),
        },
      ],
    ]);

    const slide = await parseSlide({
      archive,
      partPath: 'ppt/slides/slide1.xml',
      layoutMap,
      scale: { sx: 1, sy: 1 },
      report: new ImportReport(),
      clrMap: new Map(),
    });

    // Slide offset wins; layout extent fills in the missing width/height.
    expect(slide!.elements[0].frame).toMatchObject({ x: 500, y: 600, w: 430, h: 49 });
  });

  it('leaves the default background when neither slide nor layout defines one', async () => {
    const archive = makeArchive({
      'ppt/slides/slide1.xml': SLIDE_NO_BG,
      'ppt/slides/_rels/slide1.xml.rels': SLIDE_LAYOUT_RELS,
    });
    const layoutMap = new Map([
      [
        'ppt/slideLayouts/slideLayout1.xml',
        { builtInId: 'title-body', placeholderSizes: new Map<string, number>() },
      ],
    ]);

    const slide = await parseSlide({
      archive,
      partPath: 'ppt/slides/slide1.xml',
      layoutMap,
      scale: { sx: 1, sy: 1 },
      report: new ImportReport(),
      clrMap: new Map(),
    });

    expect(slide!.background.image).toBeUndefined();
    expect(slide!.background.fill).toEqual({ kind: 'role', role: 'background' });
  });
});

describe('parseSlide — blipFill background', () => {
  it('populates background.image when blipFill resolves and uploadImage is provided', async () => {
    const archive = makeArchive({
      'ppt/slides/slide1.xml': SLIDE_WITH_BLIPFILL,
      'ppt/slides/_rels/slide1.xml.rels': SLIDE_RELS,
      'ppt/media/image1.png': new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
    });
    const uploads: Array<{ mime: string; size: number }> = [];
    const report = new ImportReport();

    const slide = await parseSlide({
      archive,
      partPath: 'ppt/slides/slide1.xml',
      layoutMap: new Map(),
      uploadImage: async (bytes, mime) => {
        uploads.push({ mime, size: bytes.byteLength });
        return `cdn://uploaded/${uploads.length}.png`;
      },
      scale: { sx: 1, sy: 1 },
      report,
      clrMap: new Map(),
    });

    expect(slide).toBeDefined();
    expect(slide!.background.image).toEqual({
      src: 'cdn://uploaded/1.png',
      opacity: 0.8,
    });
    // Theme-role fill stays on so transparent regions still get a color.
    expect(slide!.background.fill).toEqual({ kind: 'role', role: 'background' });
    expect(uploads).toEqual([{ mime: 'image/png', size: 4 }]);
    expect(report.skippedImages).toBe(0);
  });

  it('falls back to a color background when uploadImage is not configured', async () => {
    const archive = makeArchive({
      'ppt/slides/slide1.xml': SLIDE_WITH_BLIPFILL,
      'ppt/slides/_rels/slide1.xml.rels': SLIDE_RELS,
      'ppt/media/image1.png': new Uint8Array([0x89]),
    });
    const report = new ImportReport();

    const slide = await parseSlide({
      archive,
      partPath: 'ppt/slides/slide1.xml',
      layoutMap: new Map(),
      // no uploadImage — dry-run / CLI fixture style
      scale: { sx: 1, sy: 1 },
      report,
      clrMap: new Map(),
    });

    expect(slide).toBeDefined();
    expect(slide!.background.image).toBeUndefined();
    expect(report.skippedImages).toBeGreaterThan(0);
  });

  it('counts a skip and falls through when the blip rel does not resolve', async () => {
    const archive = makeArchive({
      'ppt/slides/slide1.xml': SLIDE_BLIPFILL_NO_REL,
      'ppt/slides/_rels/slide1.xml.rels': SLIDE_RELS,
    });
    const report = new ImportReport();

    const slide = await parseSlide({
      archive,
      partPath: 'ppt/slides/slide1.xml',
      layoutMap: new Map(),
      uploadImage: async () => 'cdn://unused.png',
      scale: { sx: 1, sy: 1 },
      report,
      clrMap: new Map(),
    });

    expect(slide).toBeDefined();
    expect(slide!.background.image).toBeUndefined();
    expect(report.skippedImages).toBe(1);
  });
});

/**
 * Slide-21 regression: when a `<p:cxnSp>` targets an ellipse via
 * `<a:endCxn id idx="3"/>`, the production parseSlide path must
 * thread `shapeKindByPptxId` so `ooxmlToWaffleSiteIndex` picks the
 * ellipse identity remap (stores idx=3 verbatim) instead of the
 * rect-family swap remap (which sends idx=3 → siteIndex=1).
 *
 * idx=3 is deliberate: it's one of the two indices (1 and 3) where
 * the rect remap `[0, 3, 2, 1]` actually diverges from identity. If
 * a future change drops the `shapeKindByPptxId: new Map()` init from
 * `slide.ts` (or otherwise breaks the kind lookup so it returns
 * undefined for the target), the importer silently falls back to
 * the rect remap and stores siteIndex=1 (NW on the ellipse, top-left
 * diagonal) instead of 3 (SW, bottom-left diagonal). This test
 * asserts the resolved world position is the SW corner at
 * (0.1464, 0.8536), which only matches when the ellipse path runs.
 *
 * Indices 0, 2, 4-7 cannot detect the regression because both remaps
 * return the same number for those inputs (rect because of
 * out-of-range fallback, ellipse because of identity).
 */
const SLIDE_WITH_ELLIPSE_AND_CONNECTOR = `<?xml version="1.0"?>
<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
       xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
       xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <p:cSld>
    <p:spTree>
      <p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
      <p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>
      <p:sp>
        <p:nvSpPr><p:cNvPr id="5" name="ellipse"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
        <p:spPr>
          <a:xfrm><a:off x="100" y="100"/><a:ext cx="200" cy="200"/></a:xfrm>
          <a:prstGeom prst="ellipse"><a:avLst/></a:prstGeom>
        </p:spPr>
      </p:sp>
      <p:cxnSp>
        <p:nvCxnSpPr>
          <p:cNvPr id="6" name="c"/>
          <p:cNvCxnSpPr><a:endCxn id="5" idx="3"/></p:cNvCxnSpPr>
          <p:nvPr/>
        </p:nvCxnSpPr>
        <p:spPr>
          <a:xfrm><a:off x="0" y="200"/><a:ext cx="100" cy="0"/></a:xfrm>
          <a:prstGeom prst="straightConnector1"><a:avLst/></a:prstGeom>
        </p:spPr>
      </p:cxnSp>
    </p:spTree>
  </p:cSld>
</p:sld>`;

describe('parseSlide — ellipse connector site remap (slide-21 regression)', () => {
  it('threads shapeKindByPptxId so an ellipse endCxn idx=3 lands on the SW site, not NW (rect swap)', async () => {
    const { getConnectionSites } = await import(
      '../../../src/view/canvas/connection-sites/index'
    );
    const archive = makeArchive({
      'ppt/slides/slide1.xml': SLIDE_WITH_ELLIPSE_AND_CONNECTOR,
    });
    const slide = await parseSlide({
      archive,
      partPath: 'ppt/slides/slide1.xml',
      layoutMap: new Map(),
      scale: { sx: 1, sy: 1 },
      report: new ImportReport(),
      clrMap: new Map(),
    });
    expect(slide).toBeDefined();
    const target = slide!.elements.find((e) => e.type === 'shape');
    const connector = slide!.elements.find((e) => e.type === 'connector');
    expect(target).toBeDefined();
    expect(connector).toBeDefined();
    if (connector?.type !== 'connector') return;
    expect(connector.end.kind).toBe('attached');
    if (connector.end.kind !== 'attached') return;
    // Ellipse-aware path stores idx=3 verbatim (SW). A regressed
    // shapeKindByPptxId threading would silently apply the rect
    // remap and store siteIndex=1 (NW) instead.
    expect(connector.end.siteIndex).toBe(3);
    const sites = getConnectionSites(target!);
    expect(sites).toHaveLength(8);
    const site = sites[connector.end.siteIndex];
    // SW on the ellipse outline: (0.5 - SQRT1_2/2, 0.5 + SQRT1_2/2)
    expect(site.x).toBeCloseTo(0.5 - Math.SQRT1_2 / 2, 5);
    expect(site.y).toBeCloseTo(0.5 + Math.SQRT1_2 / 2, 5);
  });
});

describe('parseSlideBackground — gradient fill', () => {
  const imageCtx: ImageParseContext = {
    archive: makeArchive({}),
    slidePartPath: 'ppt/slides/slide1.xml',
    rels: new Map(),
    scale: { sx: 1, sy: 1 },
    report: new ImportReport(),
  };

  it('parses <a:gradFill> into a gradient Background.fill with 2 stops', async () => {
    const xml = `<?xml version="1.0"?>
<p:bg xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
      xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
  <p:bgPr>
    <a:gradFill>
      <a:gsLst>
        <a:gs pos="0"><a:srgbClr val="FFFFFF"/></a:gs>
        <a:gs pos="100000"><a:srgbClr val="000000"/></a:gs>
      </a:gsLst>
      <a:lin ang="0" scaled="1"/>
    </a:gradFill>
  </p:bgPr>
</p:bg>`;
    const bgEl = descendant(parseXml(xml), 'bg');
    expect(bgEl).toBeDefined();

    const bg = await parseSlideBackground(bgEl!, new Map(), imageCtx);

    expect(bg.fill?.kind).toBe('gradient');
    if (bg.fill?.kind !== 'gradient') return;
    expect(bg.fill.type).toBe('linear');
    expect(bg.fill.stops).toHaveLength(2);
    expect(bg.fill.stops[0]).toEqual({ pos: 0, color: { kind: 'srgb', value: '#FFFFFF' } });
    expect(bg.fill.stops[1]).toEqual({ pos: 1, color: { kind: 'srgb', value: '#000000' } });
  });
});
