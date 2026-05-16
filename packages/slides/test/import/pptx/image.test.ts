// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { parsePic } from '../../../src/import/pptx/image';
import { ImportReport } from '../../../src/import/pptx/report';
import { emuScale, DEFAULT_WIDESCREEN_EMU } from '../../../src/import/pptx/geometry';
import { parseXml } from '../../../src/import/pptx/xml';
import type { PptxArchive } from '../../../src/import/pptx/unzip';

function picEl(xml: string): Element {
  return parseXml(
    `<root xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">${xml}</root>`,
  ).documentElement.firstElementChild!;
}

function fakeArchive(media: Record<string, Uint8Array>): PptxArchive {
  return {
    readText: async () => undefined,
    readBytes: async (path) => media[path],
    list: () => Object.keys(media),
  };
}

const PIC = `<p:pic>
  <p:blipFill><a:blip r:embed="rId3"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>
  <p:spPr><a:xfrm><a:off x="914400" y="457200"/><a:ext cx="1828800" cy="914400"/></a:xfrm></p:spPr>
</p:pic>`;

describe('parsePic', () => {
  it('uploads image bytes and emits an ImageElement', async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    let receivedMime = '';
    let receivedBytes: Uint8Array | undefined;
    const archive = fakeArchive({ 'ppt/media/image1.png': bytes });
    const report = new ImportReport();
    const result = await parsePic(picEl(PIC), {
      archive,
      slidePartPath: 'ppt/slides/slide1.xml',
      rels: new Map([
        ['rId3', { type: 'image', target: '../media/image1.png', external: false }],
      ]),
      uploadImage: async (b, m) => {
        receivedBytes = b;
        receivedMime = m;
        return 'https://cdn/image1.png';
      },
      scale: emuScale(DEFAULT_WIDESCREEN_EMU),
      report,
    });
    expect(result?.type).toBe('image');
    expect(result?.data.src).toBe('https://cdn/image1.png');
    expect(receivedMime).toBe('image/png');
    expect(receivedBytes).toBe(bytes);
    expect(result?.frame.w).toBeGreaterThan(0);
    expect(report.skippedImages).toBe(0);
  });

  it('skips when uploadImage is not provided', async () => {
    const report = new ImportReport();
    const result = await parsePic(picEl(PIC), {
      archive: fakeArchive({}),
      slidePartPath: 'ppt/slides/slide1.xml',
      rels: new Map([
        ['rId3', { type: 'image', target: '../media/image1.png', external: false }],
      ]),
      scale: emuScale(DEFAULT_WIDESCREEN_EMU),
      report,
    });
    expect(result).toBeUndefined();
    expect(report.skippedImages).toBe(1);
  });

  it('parses <a:srcRect> as a normalized Crop', async () => {
    const pic = picEl(`<p:pic>
      <p:blipFill>
        <a:blip r:embed="rId3"/>
        <a:srcRect l="10000" t="20000" r="0" b="0"/>
        <a:stretch><a:fillRect/></a:stretch>
      </p:blipFill>
      <p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="914400"/></a:xfrm></p:spPr>
    </p:pic>`);
    const result = await parsePic(pic, {
      archive: fakeArchive({ 'ppt/media/image1.png': new Uint8Array([1]) }),
      slidePartPath: 'ppt/slides/slide1.xml',
      rels: new Map([
        ['rId3', { type: 'image', target: '../media/image1.png', external: false }],
      ]),
      uploadImage: async () => 'u',
      scale: emuScale(DEFAULT_WIDESCREEN_EMU),
      report: new ImportReport(),
    });
    expect(result?.data.crop).toEqual({ x: 0.1, y: 0.2, w: 0.9, h: 0.8 });
  });

  it('skips and bumps the report when uploadImage throws', async () => {
    const report = new ImportReport();
    const result = await parsePic(picEl(PIC), {
      archive: fakeArchive({ 'ppt/media/image1.png': new Uint8Array([1]) }),
      slidePartPath: 'ppt/slides/slide1.xml',
      rels: new Map([
        ['rId3', { type: 'image', target: '../media/image1.png', external: false }],
      ]),
      uploadImage: async () => {
        throw new Error('network down');
      },
      scale: emuScale(DEFAULT_WIDESCREEN_EMU),
      report,
    });
    expect(result).toBeUndefined();
    expect(report.skippedImages).toBe(1);
  });

  it('skips and bumps the report when the rel is missing', async () => {
    const report = new ImportReport();
    const result = await parsePic(picEl(PIC), {
      archive: fakeArchive({}),
      slidePartPath: 'ppt/slides/slide1.xml',
      rels: new Map(), // no rId3
      uploadImage: async () => 'u',
      scale: emuScale(DEFAULT_WIDESCREEN_EMU),
      report,
    });
    expect(result).toBeUndefined();
    expect(report.skippedImages).toBe(1);
  });
});
