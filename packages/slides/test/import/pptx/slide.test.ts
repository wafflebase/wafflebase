// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { parseSlide } from '../../../src/import/pptx/slide';
import { ImportReport } from '../../../src/import/pptx/report';
import type { PptxArchive } from '../../../src/import/pptx/unzip';

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
 * `<a:endCxn id idx="6"/>`, the production parseSlide path must
 * resolve the OOXML idx to the ellipse-aware E cardinal site
 * (siteIndex 6 in PPTX cxnLst order), not the rect-family remap's
 * out-of-range fallback. The ctx in slide.ts must initialize
 * shapeKindByPptxId for the kind lookup to fire — this test guards
 * that initialization.
 *
 * idx=6 is deliberate: under the bug, the rect remap returns
 * `OOXML_TO_WAFFLE_RECT_SITE_INDEX[6] ?? 6 = 6`, which then misses
 * `fourCardinal()`'s 4-entry array at the renderer. The fix routes
 * to `ELLIPSE_SITES` where idx=6 is the E mid-edge — observable as
 * an 8-site sites list with a real E entry at sites[6].
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
          <p:cNvCxnSpPr><a:endCxn id="5" idx="6"/></p:cNvCxnSpPr>
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
  it('threads shapeKindByPptxId so an ellipse endCxn idx=6 lands on the E site', async () => {
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
    // Under the bug, rect-family remap on idx=6 stores 6 verbatim, but
    // `getConnectionSites` returns FOUR_CARDINAL (length 4), so sites[6]
    // is undefined and the renderer falls back to sites[0] = N. With
    // the fix, the ellipse override returns ELLIPSE_SITES (length 8)
    // and sites[6] = (1, 0.5) — the E mid-edge.
    expect(connector.end.siteIndex).toBe(6);
    const sites = getConnectionSites(target!);
    expect(sites).toHaveLength(8);
    const site = sites[connector.end.siteIndex];
    expect(site.x).toBeCloseTo(1, 5);
    expect(site.y).toBeCloseTo(0.5, 5);
  });
});
