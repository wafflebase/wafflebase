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

  it('derives a cover Crop from a negative <a:stretch><a:fillRect>', async () => {
    // Slide-3 "Freeform 15" values: a 2:3 portrait photo fill-cropped into a
    // square shape. Negative insets scale the image past the shape bounds; the
    // equivalent source crop must restore the un-distorted cover region.
    const pic = picEl(`<p:pic>
      <p:blipFill>
        <a:blip r:embed="rId3"/>
        <a:stretch><a:fillRect l="-31963" t="-36905" r="-9496" b="-75284"/></a:stretch>
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
    expect(result?.data.crop?.x).toBeCloseTo(0.22595, 4);
    expect(result?.data.crop?.y).toBeCloseTo(0.17393, 4);
    expect(result?.data.crop?.w).toBeCloseTo(0.70692, 4);
    expect(result?.data.crop?.h).toBeCloseTo(0.47128, 4);
  });

  it('ignores a default (all-zero) <a:fillRect> — no crop', async () => {
    const pic = picEl(`<p:pic>
      <p:blipFill>
        <a:blip r:embed="rId3"/>
        <a:stretch><a:fillRect l="0" t="0" r="0" b="0"/></a:stretch>
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
    expect(result?.data.crop).toBeUndefined();
  });

  it('skips a positive-inset (letterbox) <a:fillRect> — no crop', async () => {
    // Positive insets draw the image *inside* the shape (margins). Our Crop
    // model is source-only, so we leave it as a full stretch rather than
    // sampling outside the image bounds.
    const pic = picEl(`<p:pic>
      <p:blipFill>
        <a:blip r:embed="rId3"/>
        <a:stretch><a:fillRect l="10000" t="10000" r="10000" b="10000"/></a:stretch>
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
    expect(result?.data.crop).toBeUndefined();
  });

  it('skips a degenerate <a:fillRect> whose insets collapse the fill region', async () => {
    // l+r >= 1 (or t+b >= 1) makes the fill width/height non-positive; bail.
    const pic = picEl(`<p:pic>
      <p:blipFill>
        <a:blip r:embed="rId3"/>
        <a:stretch><a:fillRect l="60000" t="0" r="60000" b="0"/></a:stretch>
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
    expect(result?.data.crop).toBeUndefined();
  });

  it('prefers <a:srcRect> over <a:fillRect> when both are present', async () => {
    const pic = picEl(`<p:pic>
      <p:blipFill>
        <a:blip r:embed="rId3"/>
        <a:srcRect l="10000" t="20000" r="0" b="0"/>
        <a:stretch><a:fillRect l="-50000" t="-50000" r="0" b="0"/></a:stretch>
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

  it('maps <a:alphaModFix amt="19000"/> to data.opacity ≈ 0.19', async () => {
    const pic = picEl(`<p:pic>
      <p:blipFill>
        <a:blip r:embed="rId3"><a:alphaModFix amt="19000"/></a:blip>
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
    expect(result?.data.opacity).toBeCloseTo(0.19, 5);
  });

  it('leaves opacity undefined when no alphaModFix is present', async () => {
    const result = await parsePic(picEl(PIC), {
      archive: fakeArchive({ 'ppt/media/image1.png': new Uint8Array([1]) }),
      slidePartPath: 'ppt/slides/slide1.xml',
      rels: new Map([
        ['rId3', { type: 'image', target: '../media/image1.png', external: false }],
      ]),
      uploadImage: async () => 'u',
      scale: emuScale(DEFAULT_WIDESCREEN_EMU),
      report: new ImportReport(),
    });
    expect(result?.data.opacity).toBeUndefined();
  });

  it('treats alphaModFix amt="100000" as default (no opacity field)', async () => {
    const pic = picEl(`<p:pic>
      <p:blipFill>
        <a:blip r:embed="rId3"><a:alphaModFix amt="100000"/></a:blip>
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
    expect(result?.data.opacity).toBeUndefined();
  });

  it('clamps out-of-range alphaModFix amt values to [0, 1]', async () => {
    const high = picEl(`<p:pic>
      <p:blipFill>
        <a:blip r:embed="rId3"><a:alphaModFix amt="150000"/></a:blip>
        <a:stretch><a:fillRect/></a:stretch>
      </p:blipFill>
      <p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="914400"/></a:xfrm></p:spPr>
    </p:pic>`);
    const highResult = await parsePic(high, {
      archive: fakeArchive({ 'ppt/media/image1.png': new Uint8Array([1]) }),
      slidePartPath: 'ppt/slides/slide1.xml',
      rels: new Map([
        ['rId3', { type: 'image', target: '../media/image1.png', external: false }],
      ]),
      uploadImage: async () => 'u',
      scale: emuScale(DEFAULT_WIDESCREEN_EMU),
      report: new ImportReport(),
    });
    // >= 100% clamps to 1, which is the default, so opacity stays undefined.
    expect(highResult?.data.opacity).toBeUndefined();

    const low = picEl(`<p:pic>
      <p:blipFill>
        <a:blip r:embed="rId3"><a:alphaModFix amt="-5000"/></a:blip>
        <a:stretch><a:fillRect/></a:stretch>
      </p:blipFill>
      <p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="914400"/></a:xfrm></p:spPr>
    </p:pic>`);
    const lowResult = await parsePic(low, {
      archive: fakeArchive({ 'ppt/media/image1.png': new Uint8Array([1]) }),
      slidePartPath: 'ppt/slides/slide1.xml',
      rels: new Map([
        ['rId3', { type: 'image', target: '../media/image1.png', external: false }],
      ]),
      uploadImage: async () => 'u',
      scale: emuScale(DEFAULT_WIDESCREEN_EMU),
      report: new ImportReport(),
    });
    expect(lowResult?.data.opacity).toBe(0);
  });
});
