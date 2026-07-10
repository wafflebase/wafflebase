// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { parseMaster } from '../../../src/import/pptx/master';
import type { ImageParseContext } from '../../../src/import/pptx/image';
import { ImportReport } from '../../../src/import/pptx/report';

const MIN_MASTER = `<?xml version="1.0"?>
<p:sldMaster xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
             xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
  <p:cSld>
    <p:bg><p:bgPr><a:solidFill><a:schemeClr val="bg1"/></a:solidFill></p:bgPr></p:bg>
    <p:spTree/>
  </p:cSld>
</p:sldMaster>`;

const SRGB_MASTER = `<?xml version="1.0"?>
<p:sldMaster xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
             xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
  <p:cSld>
    <p:bg><p:bgPr><a:solidFill><a:srgbClr val="F3F3F3"/></a:solidFill></p:bgPr></p:bg>
    <p:spTree/>
  </p:cSld>
</p:sldMaster>`;

const stubImageCtx = (): ImageParseContext => ({
  archive: {
    readText: async () => undefined,
    readBytes: async () => undefined,
    list: () => [],
  },
  slidePartPath: 'ppt/slideMasters/slideMaster1.xml',
  rels: new Map(),
  uploadImage: undefined,
  scale: { sx: 1, sy: 1 },
  report: new ImportReport(),
});

describe('parseMaster', () => {
  it('captures the master background as a theme-bound role', async () => {
    const { master, clrMap } = await parseMaster(
      MIN_MASTER,
      'master-1',
      'imported-yorkie',
      stubImageCtx(),
    );
    expect(master.id).toBe('master-1');
    expect(master.themeId).toBe('imported-yorkie');
    expect(master.background.fill).toEqual({ kind: 'role', role: 'background' });
    expect(clrMap.size).toBe(0); // identity (no <p:clrMap>)
  });

  it('captures a literal sRGB background', async () => {
    const { master } = await parseMaster(SRGB_MASTER, 'm', 't', stubImageCtx());
    expect(master.background.fill).toEqual({ kind: 'srgb', value: '#F3F3F3' });
  });

  it('inherits the default placeholder-style table for now', async () => {
    const { master } = await parseMaster(MIN_MASTER, 'm', 't', stubImageCtx());
    expect(master.placeholderStyles.title.fontSize).toBe(44);
    expect(master.placeholderStyles.body.fontSize).toBe(18);
  });

  it('parses <p:txStyles> marker defaults per slot × level', async () => {
    const xml = `<?xml version="1.0"?>
<p:sldMaster xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
             xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
  <p:cSld><p:bg><p:bgPr><a:solidFill><a:schemeClr val="bg1"/></a:solidFill></p:bgPr></p:bg><p:spTree/></p:cSld>
  <p:txStyles>
    <p:titleStyle>
      <a:lvl1pPr>
        <a:buFont typeface="Calibri"/>
        <a:buClr><a:srgbClr val="000000"/></a:buClr>
        <a:defRPr sz="4400"/>
      </a:lvl1pPr>
    </p:titleStyle>
    <p:bodyStyle>
      <a:lvl1pPr>
        <a:buFont typeface="Arial"/>
        <a:buClr><a:srgbClr val="000000"/></a:buClr>
        <a:defRPr sz="1400"/>
      </a:lvl1pPr>
      <a:lvl2pPr>
        <a:buFont typeface="Arial"/>
        <a:buSzPts val="1400"/>
      </a:lvl2pPr>
    </p:bodyStyle>
  </p:txStyles>
</p:sldMaster>`;
    const { txStylesMarkers } = await parseMaster(xml, 'm', 't', stubImageCtx());
    const title = txStylesMarkers.get('title');
    const body = txStylesMarkers.get('body');
    expect(title?.get(0)).toEqual({
      fontFamily: 'Calibri',
      color: { kind: 'srgb', value: '#000000' },
    });
    expect(body?.get(0)).toEqual({
      fontFamily: 'Arial',
      color: { kind: 'srgb', value: '#000000' },
    });
    expect(body?.get(1)).toEqual({ fontFamily: 'Arial', fontSize: 14 });
    // Slots without <p:*Style> stay absent (sparse map).
    expect(txStylesMarkers.has('other')).toBe(false);
  });

  it('returns an empty marker map when <p:txStyles> is omitted', async () => {
    const { txStylesMarkers } = await parseMaster(MIN_MASTER, 'm', 't', stubImageCtx());
    expect(txStylesMarkers.size).toBe(0);
  });

  it('parses <p:txStyles> default alignment per slot from lvl1pPr algn', async () => {
    const xml = `<?xml version="1.0"?>
<p:sldMaster xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
             xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
  <p:cSld><p:bg><p:bgPr><a:solidFill><a:schemeClr val="bg1"/></a:solidFill></p:bgPr></p:bg><p:spTree/></p:cSld>
  <p:txStyles>
    <p:titleStyle><a:lvl1pPr algn="ctr"><a:defRPr sz="4400"/></a:lvl1pPr></p:titleStyle>
    <p:bodyStyle><a:lvl1pPr><a:defRPr sz="1400"/></a:lvl1pPr></p:bodyStyle>
  </p:txStyles>
</p:sldMaster>`;
    const { txStylesAlignments } = await parseMaster(xml, 'm', 't', stubImageCtx());
    expect(txStylesAlignments.get('title')).toBe('center');
    // A slot whose lvl1pPr has no algn contributes no default.
    expect(txStylesAlignments.has('body')).toBe(false);
    expect(txStylesAlignments.has('other')).toBe(false);
  });

  it('returns an empty alignment map when <p:txStyles> is omitted', async () => {
    const { txStylesAlignments } = await parseMaster(MIN_MASTER, 'm', 't', stubImageCtx());
    expect(txStylesAlignments.size).toBe(0);
  });

  it('populates background.image from a master-level blipFill', async () => {
    const xml = `<?xml version="1.0"?>
<p:sldMaster xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
             xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
             xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <p:cSld>
    <p:bg>
      <p:bgPr>
        <a:blipFill>
          <a:blip r:embed="rIdBg"/>
          <a:stretch><a:fillRect/></a:stretch>
        </a:blipFill>
      </p:bgPr>
    </p:bg>
    <p:spTree/>
  </p:cSld>
</p:sldMaster>`;
    const ctx: ImageParseContext = {
      archive: {
        readText: async () => undefined,
        readBytes: async (path) =>
          path === 'ppt/media/image1.png' ? new Uint8Array([0x89]) : undefined,
        list: () => [],
      },
      slidePartPath: 'ppt/slideMasters/slideMaster1.xml',
      rels: new Map([
        [
          'rIdBg',
          { type: 'image', target: '../media/image1.png', external: false },
        ],
      ]),
      uploadImage: async () => 'cdn://master-bg.png',
      scale: { sx: 1, sy: 1 },
      report: new ImportReport(),
    };

    const { master } = await parseMaster(xml, 'm', 't', ctx);
    expect(master.background.image).toEqual({ src: 'cdn://master-bg.png' });
    // Fill stays as the theme role so transparent regions still get a color.
    expect(master.background.fill).toEqual({ kind: 'role', role: 'background' });
    expect(ctx.report.skippedImages).toBe(0);
  });

  it('falls back to color-only when the master blipFill upload is missing', async () => {
    const xml = `<?xml version="1.0"?>
<p:sldMaster xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
             xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
             xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <p:cSld>
    <p:bg>
      <p:bgPr>
        <a:blipFill><a:blip r:embed="rIdBg"/></a:blipFill>
      </p:bgPr>
    </p:bg>
    <p:spTree/>
  </p:cSld>
</p:sldMaster>`;
    const { master } = await parseMaster(xml, 'm', 't', stubImageCtx());
    expect(master.background.image).toBeUndefined();
    // No solid sibling either, so we land on the default role-bound fill.
    expect(master.background.fill).toEqual({ kind: 'role', role: 'background' });
  });

  it('parses non-identity <p:clrMap> mappings (benchmark deck swaps bg2/tx2)', async () => {
    const xml = `<?xml version="1.0"?>
<p:sldMaster xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
             xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
  <p:cSld><p:spTree/></p:cSld>
  <p:clrMap bg1="lt1" tx1="dk1" bg2="dk2" tx2="lt2"
            accent1="accent1" accent2="accent2" accent3="accent3"
            accent4="accent4" accent5="accent5" accent6="accent6"
            hlink="hlink" folHlink="folHlink"/>
</p:sldMaster>`;
    const { clrMap } = await parseMaster(xml, 'm', 't', stubImageCtx());
    // Identity entries skipped; only the swaps land in the map.
    expect(clrMap.get('bg2')).toBe('dk2');
    expect(clrMap.get('tx2')).toBe('lt2');
    expect(clrMap.has('bg1')).toBe(false);
    expect(clrMap.has('accent1')).toBe(false);
  });
});
