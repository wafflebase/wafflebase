// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { parseSlide } from '../../../src/import/pptx/slide';
import { ImportReport } from '../../../src/import/pptx/report';
import type { PptxArchive } from '../../../src/import/pptx/unzip';

function makeArchive(files: Record<string, string>): PptxArchive {
  return {
    readText: async (path) => files[path],
    readBytes: async () => undefined,
    list: () => [],
  };
}

/**
 * A `<p:sp>` that carries both `prstGeom` (a roundRect) and a non-empty
 * `<p:txBody>` ("Hi"). Pre-shape-text-body imports emitted this as two
 * layered elements (ShapeElement + paired TextElement); the new
 * importer folds the text into the shape's `data.text`.
 */
const SLIDE_WITH_SHAPE_AND_TEXT = `<?xml version="1.0"?>
<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
       xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
  <p:cSld>
    <p:spTree>
      <p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
      <p:grpSpPr/>
      <p:sp>
        <p:nvSpPr><p:cNvPr id="2" name="Rounded"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
        <p:spPr>
          <a:xfrm>
            <a:off x="0" y="0"/>
            <a:ext cx="2000000" cy="1000000"/>
          </a:xfrm>
          <a:prstGeom prst="roundRect"><a:avLst/></a:prstGeom>
          <a:solidFill><a:srgbClr val="ABCDEF"/></a:solidFill>
        </p:spPr>
        <p:txBody>
          <a:bodyPr/>
          <a:lstStyle/>
          <a:p><a:r><a:rPr lang="en-US"/><a:t>Hi</a:t></a:r></a:p>
        </p:txBody>
      </p:sp>
    </p:spTree>
  </p:cSld>
</p:sld>`;

/**
 * A `<p:sp>` with `prstGeom` but only an empty paragraph in `<p:txBody>`
 * — the shape was created but the user never typed in it. PowerPoint
 * emits an empty `<a:p>` on every shape; the importer must NOT seed an
 * empty `data.text` for this case (round-trip noise).
 */
const SLIDE_WITH_SHAPE_AND_EMPTY_TEXT = `<?xml version="1.0"?>
<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
       xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
  <p:cSld>
    <p:spTree>
      <p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
      <p:grpSpPr/>
      <p:sp>
        <p:nvSpPr><p:cNvPr id="2" name="Plain"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
        <p:spPr>
          <a:xfrm>
            <a:off x="0" y="0"/>
            <a:ext cx="2000000" cy="1000000"/>
          </a:xfrm>
          <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
        </p:spPr>
        <p:txBody>
          <a:bodyPr/>
          <a:lstStyle/>
          <a:p><a:endParaRPr/></a:p>
        </p:txBody>
      </p:sp>
    </p:spTree>
  </p:cSld>
</p:sld>`;

describe('parseSlide — shape inline text', () => {
  it('folds <p:txBody> inside a prstGeom <p:sp> into ShapeElement.data.text', async () => {
    const slide = await parseSlide({
      archive: makeArchive({
        'ppt/slides/slide1.xml': SLIDE_WITH_SHAPE_AND_TEXT,
      }),
      partPath: 'ppt/slides/slide1.xml',
      layoutMap: new Map(),
      scale: { sx: 1, sy: 1 },
      report: new ImportReport(),
      clrMap: new Map(),
    });
    expect(slide).toBeDefined();
    // Single element, not the legacy two-layered (shape + text) form.
    expect(slide!.elements).toHaveLength(1);
    const el = slide!.elements[0];
    expect(el.type).toBe('shape');
    if (el.type !== 'shape') return;
    expect(el.data.kind).toBe('roundRect');
    expect(el.data.text?.blocks).toBeDefined();
    expect(el.data.text!.blocks[0].inlines.map((i) => i.text).join('')).toBe('Hi');
  });

  it('does not seed data.text when the shape\'s txBody carries no visible characters', async () => {
    const slide = await parseSlide({
      archive: makeArchive({
        'ppt/slides/slide1.xml': SLIDE_WITH_SHAPE_AND_EMPTY_TEXT,
      }),
      partPath: 'ppt/slides/slide1.xml',
      layoutMap: new Map(),
      scale: { sx: 1, sy: 1 },
      report: new ImportReport(),
      clrMap: new Map(),
    });
    expect(slide).toBeDefined();
    expect(slide!.elements).toHaveLength(1);
    const el = slide!.elements[0];
    expect(el.type).toBe('shape');
    if (el.type !== 'shape') return;
    expect(el.data.text).toBeUndefined();
  });
});
