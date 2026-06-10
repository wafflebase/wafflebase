// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import {
  parseSpTree,
  type SlideParseContext,
} from '../../../src/import/pptx/shape';
import { ImportReport } from '../../../src/import/pptx/report';
import {
  DEFAULT_WIDESCREEN_EMU,
  emuScale,
} from '../../../src/import/pptx/geometry';
import { parseXml } from '../../../src/import/pptx/xml';
import type { PptxRel } from '../../../src/import/pptx/rels';
import type { PptxArchive } from '../../../src/import/pptx/unzip';
import type {
  ImageElement,
  TextElement,
} from '../../../src/model/element';

const SCALE = emuScale(DEFAULT_WIDESCREEN_EMU);

function archive(media: Record<string, Uint8Array> = {}): PptxArchive {
  return {
    readText: async () => undefined,
    readBytes: async (path) => media[path],
    list: () => [],
  };
}

function rels(target: string): Map<string, PptxRel> {
  const m = new Map<string, PptxRel>();
  m.set('rId1', { type: 'image', target, external: false });
  return m;
}

function ctx(opts: {
  archive?: PptxArchive;
  rels?: Map<string, PptxRel>;
  uploadImage?: (b: Uint8Array, m: string) => Promise<string>;
} = {}): SlideParseContext {
  return {
    archive: opts.archive ?? archive(),
    slidePartPath: 'ppt/slides/slide1.xml',
    rels: opts.rels ?? new Map(),
    uploadImage: opts.uploadImage,
    scale: SCALE,
    report: new ImportReport(),
    idMap: new Map(),
    shapeKindByPptxId: new Map(),
    placeholderSizes: new Map(),
    clrMap: new Map(),
  };
}

function spTreeFrom(spXml: string): Element {
  return parseXml(
    `<root xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><p:spTree>${spXml}</p:spTree></root>`,
  ).documentElement.firstElementChild!;
}

/**
 * Mimics the user-supplied "doodle" template: a `<p:sp>` whose `<p:spPr>`
 * carries `<a:custGeom>` and a `<a:blipFill>` covering the entire slide.
 * Before the fix this was silently dropped (no fill, invisible rect);
 * after the fix it becomes a coincident `ImageElement`.
 */
const SP_CUSTGEOM_BLIPFILL = `<p:sp>
  <p:nvSpPr><p:cNvPr id="2" name="Freeform 2"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
  <p:spPr>
    <a:xfrm><a:off x="0" y="0"/><a:ext cx="18288000" cy="10287000"/></a:xfrm>
    <a:custGeom><a:avLst/><a:gdLst/><a:ahLst/><a:cxnLst/><a:rect r="r" b="b" t="t" l="l"/><a:pathLst/></a:custGeom>
    <a:blipFill>
      <a:blip r:embed="rId1"/>
      <a:stretch><a:fillRect/></a:stretch>
    </a:blipFill>
  </p:spPr>
</p:sp>`;

const SP_RECT_BLIPFILL = `<p:sp>
  <p:nvSpPr><p:cNvPr id="3" name="Pic-shaped Rect"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
  <p:spPr>
    <a:xfrm><a:off x="100000" y="100000"/><a:ext cx="900000" cy="600000"/></a:xfrm>
    <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
    <a:blipFill>
      <a:blip r:embed="rId1"/>
      <a:stretch><a:fillRect/></a:stretch>
    </a:blipFill>
  </p:spPr>
</p:sp>`;

const SP_BLIPFILL_WITH_TEXT = `<p:sp>
  <p:nvSpPr><p:cNvPr id="4" name="Image with caption"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
  <p:spPr>
    <a:xfrm><a:off x="0" y="0"/><a:ext cx="9144000" cy="5143500"/></a:xfrm>
    <a:custGeom><a:avLst/><a:gdLst/><a:ahLst/><a:cxnLst/><a:rect r="r" b="b" t="t" l="l"/><a:pathLst/></a:custGeom>
    <a:blipFill>
      <a:blip r:embed="rId1"/>
      <a:stretch><a:fillRect/></a:stretch>
    </a:blipFill>
  </p:spPr>
  <p:txBody>
    <a:bodyPr/>
    <a:lstStyle/>
    <a:p><a:r><a:rPr lang="en-US" sz="2400"/><a:t>Caption</a:t></a:r></a:p>
  </p:txBody>
</p:sp>`;

/**
 * Solid-fill rect — control case proving the new branch is targeted at
 * `<a:blipFill>` only and doesn't disturb the existing prstGeom + fill
 * path.
 */
const SP_RECT_SOLID = `<p:sp>
  <p:nvSpPr><p:cNvPr id="5" name="Solid rect"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
  <p:spPr>
    <a:xfrm><a:off x="0" y="0"/><a:ext cx="500000" cy="500000"/></a:xfrm>
    <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
    <a:solidFill><a:srgbClr val="FF0000"/></a:solidFill>
  </p:spPr>
</p:sp>`;

const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);

describe('parseSp — <p:sp> with <a:blipFill>', () => {
  it('emits an ImageElement for custGeom + blipFill (the "doodle template" pattern)', async () => {
    const uploads: Array<{ bytes: Uint8Array; mime: string }> = [];
    const tree = spTreeFrom(SP_CUSTGEOM_BLIPFILL);
    const c = ctx({
      archive: archive({ 'ppt/media/image1.jpeg': PNG_BYTES }),
      rels: rels('../media/image1.jpeg'),
      uploadImage: async (bytes, mime) => {
        uploads.push({ bytes, mime });
        return 'cdn://uploaded.jpg';
      },
    });

    const out = await parseSpTree(tree, c);

    expect(out).toHaveLength(1);
    expect(out[0].type).toBe('image');
    const img = out[0] as ImageElement;
    expect(img.data.src).toBe('cdn://uploaded.jpg');
    expect(img.frame.w).toBeGreaterThan(0);
    expect(img.frame.h).toBeGreaterThan(0);
    expect(uploads).toHaveLength(1);
    expect(uploads[0].mime).toBe('image/jpeg');
  });

  it('emits an ImageElement for prstGeom rect + blipFill', async () => {
    const tree = spTreeFrom(SP_RECT_BLIPFILL);
    const c = ctx({
      archive: archive({ 'ppt/media/image1.png': PNG_BYTES }),
      rels: rels('../media/image1.png'),
      uploadImage: async () => 'cdn://rect.png',
    });

    const out = await parseSpTree(tree, c);

    expect(out).toHaveLength(1);
    expect(out[0].type).toBe('image');
    expect((out[0] as ImageElement).data.src).toBe('cdn://rect.png');
  });

  it('layers a TextElement on top when the shape also carries visible text', async () => {
    const tree = spTreeFrom(SP_BLIPFILL_WITH_TEXT);
    const c = ctx({
      archive: archive({ 'ppt/media/image1.png': PNG_BYTES }),
      rels: rels('../media/image1.png'),
      uploadImage: async () => 'cdn://captioned.png',
    });

    const out = await parseSpTree(tree, c);

    expect(out).toHaveLength(2);
    expect(out[0].type).toBe('image');
    expect(out[1].type).toBe('text');
    const text = out[1] as TextElement;
    expect(text.data.blocks.length).toBeGreaterThan(0);
    // Image and text share the same frame (coincident overlay).
    expect(out[1].frame).toEqual(out[0].frame);
  });

  it('falls through to existing path when blip upload fails', async () => {
    const tree = spTreeFrom(SP_CUSTGEOM_BLIPFILL);
    // No uploadImage → parseBlipFill returns undefined.
    const c = ctx({ rels: rels('../media/image1.jpeg') });

    const out = await parseSpTree(tree, c);

    // custGeom-only shape with no prstGeom and no text produces nothing,
    // so the shape gracefully drops rather than emitting a phantom image.
    expect(out).toHaveLength(0);
    expect(c.report.skippedImages).toBe(1);
  });

  it('falls through to the underlying shape for prstGeom + blipFill when upload fails', async () => {
    // Same prstGeom rect + blipFill XML as the success-path test, but with
    // no `uploadImage` callback: `parseBlipFill` returns undefined, the new
    // blip branch yields no image, and we fall through to the existing
    // prstGeom branch which emits the rectangle. Locks in the graceful
    // degradation contract so an image upload outage can't make rect
    // shapes vanish from the slide.
    const tree = spTreeFrom(SP_RECT_BLIPFILL);
    const c = ctx({ rels: rels('../media/image1.png') });

    const out = await parseSpTree(tree, c);

    expect(out).toHaveLength(1);
    expect(out[0].type).toBe('shape');
    expect(c.report.skippedImages).toBe(1);
  });

  it('leaves solid-filled shapes unchanged (control)', async () => {
    const tree = spTreeFrom(SP_RECT_SOLID);
    const c = ctx();

    const out = await parseSpTree(tree, c);

    expect(out).toHaveLength(1);
    expect(out[0].type).toBe('shape');
  });
});
