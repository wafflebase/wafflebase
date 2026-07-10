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

/**
 * A `txBox="1"` `<p:sp>` that carries an explicit `<a:solidFill>` background
 * and `<a:ln>` border. Google Slides exports labelled callout boxes this way
 * (e.g. the "Network Interruption" box). The importer must preserve the fill
 * and stroke; dropping them leaves the box transparent so underlying shapes
 * (a connector line, here) show through it.
 */
const SLIDE_WITH_FILLED_TEXTBOX = `<?xml version="1.0"?>
<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
       xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
  <p:cSld>
    <p:spTree>
      <p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
      <p:grpSpPr/>
      <p:sp>
        <p:nvSpPr><p:cNvPr id="2" name="Label"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr>
        <p:spPr>
          <a:xfrm>
            <a:off x="0" y="0"/>
            <a:ext cx="2000000" cy="500000"/>
          </a:xfrm>
          <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
          <a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill>
          <a:ln w="38100"><a:solidFill><a:srgbClr val="000000"/></a:solidFill></a:ln>
        </p:spPr>
        <p:txBody>
          <a:bodyPr/>
          <a:lstStyle/>
          <a:p><a:r><a:rPr lang="en-US"/><a:t>Network Interruption</a:t></a:r></a:p>
        </p:txBody>
      </p:sp>
    </p:spTree>
  </p:cSld>
</p:sld>`;

/**
 * A `txBox="1"` text box whose `<a:bodyPr>` sets explicit symmetric insets
 * (`lIns=tIns=rIns=bIns`). Google-Slides-style number-in-circle labels rely
 * on these large insets to visually center a single glyph; the importer must
 * carry them into `TextBody.inset` so the renderer reproduces the centering
 * instead of painting at the top-left corner.
 */
const SLIDE_WITH_TEXTBOX_INSETS = `<?xml version="1.0"?>
<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
       xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
  <p:cSld>
    <p:spTree>
      <p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
      <p:grpSpPr/>
      <p:sp>
        <p:nvSpPr><p:cNvPr id="2" name="Num"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr>
        <p:spPr>
          <a:xfrm><a:off x="0" y="0"/><a:ext cx="267900" cy="323100"/></a:xfrm>
          <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
        </p:spPr>
        <p:txBody>
          <a:bodyPr anchor="t" lIns="91425" tIns="91425" rIns="91425" bIns="91425"/>
          <a:lstStyle/>
          <a:p><a:r><a:rPr lang="en-US"/><a:t>1</a:t></a:r></a:p>
        </p:txBody>
      </p:sp>
    </p:spTree>
  </p:cSld>
</p:sld>`;

/**
 * A prstGeom shape (not a text box) whose folded `<p:txBody>` carries explicit
 * `<a:bodyPr>` insets. The importer must attach them to `data.text.inset`.
 */
const SLIDE_WITH_SHAPE_INSETS = `<?xml version="1.0"?>
<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
       xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
  <p:cSld>
    <p:spTree>
      <p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
      <p:grpSpPr/>
      <p:sp>
        <p:nvSpPr><p:cNvPr id="2" name="Box"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
        <p:spPr>
          <a:xfrm><a:off x="0" y="0"/><a:ext cx="2000000" cy="1000000"/></a:xfrm>
          <a:prstGeom prst="roundRect"><a:avLst/></a:prstGeom>
        </p:spPr>
        <p:txBody>
          <a:bodyPr lIns="45720" tIns="9144"/>
          <a:lstStyle/>
          <a:p><a:r><a:rPr lang="en-US"/><a:t>Hi</a:t></a:r></a:p>
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

  it('preserves the fill and border of a txBox="1" shape that carries them', async () => {
    const slide = await parseSlide({
      archive: makeArchive({
        'ppt/slides/slide1.xml': SLIDE_WITH_FILLED_TEXTBOX,
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
    expect(el.type).toBe('text');
    if (el.type !== 'text') return;
    // The white background must survive so the box stays opaque.
    expect(el.data.fill).toBeDefined();
    // The black border must survive too.
    expect(el.data.stroke).toBeDefined();
    expect(el.data.stroke!.width).toBeGreaterThan(0);
    expect(el.data.blocks[0].inlines.map((i) => i.text).join('')).toBe(
      'Network Interruption',
    );
  });

  it('does not attach an inset when <a:bodyPr> declares none', async () => {
    const slide = await parseSlide({
      archive: makeArchive({
        'ppt/slides/slide1.xml': SLIDE_WITH_FILLED_TEXTBOX,
      }),
      partPath: 'ppt/slides/slide1.xml',
      layoutMap: new Map(),
      scale: { sx: 1, sy: 1 },
      report: new ImportReport(),
      clrMap: new Map(),
    });
    const el = slide!.elements[0];
    expect(el.type).toBe('text');
    if (el.type !== 'text') return;
    // Empty `<a:bodyPr/>` — the renderer keeps its default; storing an inset
    // here would shift every plain imported text box.
    expect(el.data.inset).toBeUndefined();
  });

  it('carries explicit <a:bodyPr> insets into a text box\'s TextBody.inset', async () => {
    const slide = await parseSlide({
      archive: makeArchive({
        'ppt/slides/slide1.xml': SLIDE_WITH_TEXTBOX_INSETS,
      }),
      partPath: 'ppt/slides/slide1.xml',
      layoutMap: new Map(),
      // sx=sy=1 → inset px equals the raw EMU inset for easy assertion.
      scale: { sx: 1, sy: 1 },
      report: new ImportReport(),
      clrMap: new Map(),
    });
    const el = slide!.elements[0];
    expect(el.type).toBe('text');
    if (el.type !== 'text') return;
    expect(el.data.inset).toEqual({
      left: 91425,
      top: 91425,
      right: 91425,
      bottom: 91425,
    });
  });

  it('carries explicit <a:bodyPr> insets into a shape\'s data.text.inset, filling absent sides with OOXML defaults', async () => {
    const slide = await parseSlide({
      archive: makeArchive({
        'ppt/slides/slide1.xml': SLIDE_WITH_SHAPE_INSETS,
      }),
      partPath: 'ppt/slides/slide1.xml',
      layoutMap: new Map(),
      scale: { sx: 1, sy: 1 },
      report: new ImportReport(),
      clrMap: new Map(),
    });
    const el = slide!.elements[0];
    expect(el.type).toBe('shape');
    if (el.type !== 'shape') return;
    // lIns / tIns explicit; rIns / bIns fall back to OOXML defaults
    // (91440 / 45720) so the box stays symmetric with PowerPoint.
    expect(el.data.text?.inset).toEqual({
      left: 45720,
      top: 9144,
      right: 91440,
      bottom: 45720,
    });
  });

  it('imports an <a:gradFill> shape as a linear gradient fill', async () => {
    // Mirrors slide 4's blue header boxes: a roundRect filled with a
    // two-stop linear gradient and an explicit <a:lin ang> (45°).
    const xml = `<?xml version="1.0"?>
<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
       xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
  <p:cSld><p:spTree>
    <p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
    <p:grpSpPr/>
    <p:sp>
      <p:nvSpPr><p:cNvPr id="2" name="Box"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
      <p:spPr>
        <a:xfrm><a:off x="0" y="0"/><a:ext cx="2000000" cy="1000000"/></a:xfrm>
        <a:prstGeom prst="roundRect"><a:avLst/></a:prstGeom>
        <a:gradFill>
          <a:gsLst>
            <a:gs pos="0"><a:srgbClr val="0093FF"/></a:gs>
            <a:gs pos="100000"><a:srgbClr val="006AFF"/></a:gs>
          </a:gsLst>
          <a:lin ang="2700000" scaled="1"/>
        </a:gradFill>
      </p:spPr>
      <p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:endParaRPr/></a:p></p:txBody>
    </p:sp>
  </p:spTree></p:cSld>
</p:sld>`;
    const slide = await parseSlide({
      archive: makeArchive({ 'ppt/slides/slide1.xml': xml }),
      partPath: 'ppt/slides/slide1.xml',
      layoutMap: new Map(),
      scale: { sx: 1, sy: 1 },
      report: new ImportReport(),
      clrMap: new Map(),
    });
    const el = slide!.elements[0];
    expect(el.type).toBe('shape');
    if (el.type !== 'shape') return;
    const fill = el.data.fill;
    expect(fill?.kind).toBe('gradient');
    if (fill?.kind !== 'gradient') return;
    expect(fill.stops).toHaveLength(2);
    expect(fill.stops[0]).toEqual({ pos: 0, color: { kind: 'srgb', value: '#0093FF' } });
    expect(fill.stops[1]).toEqual({ pos: 1, color: { kind: 'srgb', value: '#006AFF' } });
    // 2700000 / 60000 = 45°.
    expect(fill.angle).toBeCloseTo(Math.PI / 4, 6);
  });

  it('defaults a gradient with no <a:lin> to a top→bottom angle', async () => {
    const xml = `<?xml version="1.0"?>
<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
       xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
  <p:cSld><p:spTree>
    <p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
    <p:grpSpPr/>
    <p:sp>
      <p:nvSpPr><p:cNvPr id="2" name="Box"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
      <p:spPr>
        <a:xfrm><a:off x="0" y="0"/><a:ext cx="2000000" cy="1000000"/></a:xfrm>
        <a:prstGeom prst="roundRect"><a:avLst/></a:prstGeom>
        <a:gradFill><a:gsLst>
          <a:gs pos="0"><a:srgbClr val="0093FF"/></a:gs>
          <a:gs pos="100000"><a:srgbClr val="006AFF"/></a:gs>
        </a:gsLst></a:gradFill>
      </p:spPr>
      <p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:endParaRPr/></a:p></p:txBody>
    </p:sp>
  </p:spTree></p:cSld>
</p:sld>`;
    const slide = await parseSlide({
      archive: makeArchive({ 'ppt/slides/slide1.xml': xml }),
      partPath: 'ppt/slides/slide1.xml',
      layoutMap: new Map(),
      scale: { sx: 1, sy: 1 },
      report: new ImportReport(),
      clrMap: new Map(),
    });
    const el = slide!.elements[0];
    if (el.type !== 'shape' || el.data.fill?.kind !== 'gradient') {
      throw new Error('expected a gradient-filled shape');
    }
    expect(el.data.fill.angle).toBeCloseTo(Math.PI / 2, 6);
  });
});
