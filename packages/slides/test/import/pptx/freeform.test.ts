// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { parseCustGeomPath } from '../../../src/import/pptx/freeform';
import { parseSlide } from '../../../src/import/pptx/slide';
import { ImportReport } from '../../../src/import/pptx/report';
import { parseXml } from '../../../src/import/pptx/xml';
import type { PptxArchive } from '../../../src/import/pptx/unzip';
import { shapeToXml } from '../../../src/export/pptx/shape';
import type { ShapeElement } from '../../../src/model/element';

function makeArchive(files: Record<string, string>): PptxArchive {
  return {
    readText: async (path) => files[path],
    readBytes: async () => undefined,
    list: () => [],
  };
}

function custGeomEl(inner: string): Element {
  const doc = parseXml(
    `<a:custGeom xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">${inner}</a:custGeom>`,
  );
  return doc.documentElement;
}

describe('parseCustGeomPath', () => {
  it('normalizes points to [0,1] of the path viewBox', () => {
    const el = custGeomEl(`
      <a:pathLst>
        <a:path w="100" h="200">
          <a:moveTo><a:pt x="50" y="100"/></a:moveTo>
          <a:lnTo><a:pt x="100" y="200"/></a:lnTo>
          <a:cubicBezTo>
            <a:pt x="0" y="0"/><a:pt x="50" y="0"/><a:pt x="100" y="100"/>
          </a:cubicBezTo>
          <a:close/>
        </a:path>
      </a:pathLst>`);
    const path = parseCustGeomPath(el);
    expect(path).toBeDefined();
    expect(path!.commands).toEqual([
      { c: 'M', x: 0.5, y: 0.5 },
      { c: 'L', x: 1, y: 1 },
      { c: 'C', x1: 0, y1: 0, x2: 0.5, y2: 0, x: 1, y: 0.5 },
      { c: 'Z' },
    ]);
  });

  it('parses quadBezTo with one control point', () => {
    const el = custGeomEl(`
      <a:pathLst>
        <a:path w="10" h="10">
          <a:moveTo><a:pt x="0" y="0"/></a:moveTo>
          <a:quadBezTo><a:pt x="5" y="10"/><a:pt x="10" y="0"/></a:quadBezTo>
        </a:path>
      </a:pathLst>`);
    const path = parseCustGeomPath(el);
    expect(path).toBeDefined();
    expect(path!.commands).toEqual([
      { c: 'M', x: 0, y: 0 },
      { c: 'Q', x1: 0.5, y1: 1, x: 1, y: 0 },
    ]);
  });

  it('reduces arcTo to a centre-parametrised arc joined to the current point', () => {
    const el = custGeomEl(`
      <a:pathLst>
        <a:path w="100" h="100">
          <a:moveTo><a:pt x="100" y="50"/></a:moveTo>
          <a:arcTo wR="50" hR="50" stAng="0" swAng="5400000"/>
        </a:path>
      </a:pathLst>`);
    const path = parseCustGeomPath(el);
    const arc = path!.commands[1];
    expect(arc.c).toBe('A');
    if (arc.c !== 'A') return;
    // start at (100,50), wR=hR=50, stAng=0 → centre (50,50) → normalized (0.5,0.5)
    expect(arc.cx).toBeCloseTo(0.5);
    expect(arc.cy).toBeCloseTo(0.5);
    expect(arc.rx).toBeCloseTo(0.5);
    expect(arc.ry).toBeCloseTo(0.5);
    expect(arc.start).toBeCloseTo(0);
    expect(arc.sweep).toBeCloseTo(Math.PI / 2); // 90°
  });

  it('returns undefined for a path with no usable viewBox', () => {
    const el = custGeomEl(
      `<a:pathLst><a:path w="0" h="0"><a:moveTo><a:pt x="1" y="1"/></a:moveTo></a:path></a:pathLst>`,
    );
    expect(parseCustGeomPath(el)).toBeUndefined();
  });
});

const SLIDE_WITH_SOLID_FREEFORM = `<?xml version="1.0"?>
<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
       xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
  <p:cSld>
    <p:spTree>
      <p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
      <p:grpSpPr/>
      <p:sp>
        <p:nvSpPr><p:cNvPr id="2" name="Freeform 7"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
        <p:spPr>
          <a:xfrm><a:off x="0" y="0"/><a:ext cx="2000000" cy="1000000"/></a:xfrm>
          <a:custGeom>
            <a:pathLst>
              <a:path w="200" h="100">
                <a:moveTo><a:pt x="0" y="0"/></a:moveTo>
                <a:lnTo><a:pt x="200" y="0"/></a:lnTo>
                <a:lnTo><a:pt x="200" y="100"/></a:lnTo>
                <a:lnTo><a:pt x="0" y="100"/></a:lnTo>
                <a:close/>
              </a:path>
            </a:pathLst>
          </a:custGeom>
          <a:solidFill><a:srgbClr val="4B6BF5"/></a:solidFill>
        </p:spPr>
      </p:sp>
    </p:spTree>
  </p:cSld>
</p:sld>`;

describe('parseSlide — custGeom freeform dispatch', () => {
  it('keeps a solid-fill custGeom shape (regression: it was silently dropped)', async () => {
    const slide = await parseSlide({
      archive: makeArchive({ 'ppt/slides/slide1.xml': SLIDE_WITH_SOLID_FREEFORM }),
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
    expect(el.data.kind).toBe('freeform');
    expect(el.data.fill).toBeDefined();
    expect(el.data.path?.commands.length).toBe(5);
    expect(el.data.path?.commands[0]).toEqual({ c: 'M', x: 0, y: 0 });
  });
});

const SLIDE_WITH_ARROWED_FREEFORM = `<?xml version="1.0"?>
<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
       xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
  <p:cSld>
    <p:spTree>
      <p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
      <p:grpSpPr/>
      <p:sp>
        <p:nvSpPr><p:cNvPr id="2" name="Freeform 9"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
        <p:spPr>
          <a:xfrm><a:off x="0" y="0"/><a:ext cx="2000000" cy="1000000"/></a:xfrm>
          <a:custGeom>
            <a:pathLst>
              <a:path w="200" h="100">
                <a:moveTo><a:pt x="0" y="0"/></a:moveTo>
                <a:cubicBezTo>
                  <a:pt x="50" y="100"/><a:pt x="150" y="100"/><a:pt x="200" y="0"/>
                </a:cubicBezTo>
              </a:path>
            </a:pathLst>
          </a:custGeom>
          <a:noFill/>
          <a:ln w="9525">
            <a:solidFill><a:srgbClr val="292929"/></a:solidFill>
            <a:headEnd len="med" w="med" type="none"/>
            <a:tailEnd len="med" w="med" type="triangle"/>
          </a:ln>
        </p:spPr>
      </p:sp>
    </p:spTree>
  </p:cSld>
</p:sld>`;

describe('parseSlide — freeform line-end arrowheads', () => {
  it('parses <a:tailEnd> on a custGeom shape into data.arrowheads.end', async () => {
    const slide = await parseSlide({
      archive: makeArchive({ 'ppt/slides/slide1.xml': SLIDE_WITH_ARROWED_FREEFORM }),
      partPath: 'ppt/slides/slide1.xml',
      layoutMap: new Map(),
      scale: { sx: 1, sy: 1 },
      report: new ImportReport(),
      clrMap: new Map(),
    });
    const el = slide!.elements[0];
    expect(el.type).toBe('shape');
    if (el.type !== 'shape') return;
    expect(el.data.kind).toBe('freeform');
    // headEnd type="none" → no start arrowhead; tailEnd triangle → end.
    expect(el.data.arrowheads?.start).toBeUndefined();
    expect(el.data.arrowheads?.end).toEqual({ kind: 'triangle', size: 'md' });
  });

  it('drops arrowheads on a closed (Z) custGeom — a loop has no open ends', async () => {
    const closed = `<?xml version="1.0"?>
<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
       xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
  <p:cSld><p:spTree>
    <p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
    <p:grpSpPr/>
    <p:sp>
      <p:nvSpPr><p:cNvPr id="2" name="Closed freeform"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
      <p:spPr>
        <a:xfrm><a:off x="0" y="0"/><a:ext cx="2000000" cy="1000000"/></a:xfrm>
        <a:custGeom><a:pathLst><a:path w="200" h="100">
          <a:moveTo><a:pt x="0" y="0"/></a:moveTo>
          <a:lnTo><a:pt x="200" y="0"/></a:lnTo>
          <a:lnTo><a:pt x="200" y="100"/></a:lnTo>
          <a:close/>
        </a:path></a:pathLst></a:custGeom>
        <a:ln w="9525">
          <a:solidFill><a:srgbClr val="292929"/></a:solidFill>
          <a:tailEnd len="med" w="med" type="triangle"/>
        </a:ln>
      </p:spPr>
    </p:sp>
  </p:spTree></p:cSld>
</p:sld>`;
    const slide = await parseSlide({
      archive: makeArchive({ 'ppt/slides/slide1.xml': closed }),
      partPath: 'ppt/slides/slide1.xml',
      layoutMap: new Map(),
      scale: { sx: 1, sy: 1 },
      report: new ImportReport(),
      clrMap: new Map(),
    });
    const el = slide!.elements[0];
    expect(el.type).toBe('shape');
    if (el.type !== 'shape') return;
    const cmds = el.data.path?.commands ?? [];
    expect(cmds[cmds.length - 1]?.c).toBe('Z');
    expect(el.data.arrowheads).toBeUndefined();
  });

  it('drops arrowheads when the line has no stroke (noFill) — nothing to decorate', async () => {
    const noStroke = SLIDE_WITH_ARROWED_FREEFORM.replace(
      '<a:solidFill><a:srgbClr val="292929"/></a:solidFill>',
      '<a:noFill/>',
    );
    const slide = await parseSlide({
      archive: makeArchive({ 'ppt/slides/slide1.xml': noStroke }),
      partPath: 'ppt/slides/slide1.xml',
      layoutMap: new Map(),
      scale: { sx: 1, sy: 1 },
      report: new ImportReport(),
      clrMap: new Map(),
    });
    const el = slide!.elements[0];
    expect(el.type).toBe('shape');
    if (el.type !== 'shape') return;
    expect(el.data.stroke).toBeUndefined();
    expect(el.data.arrowheads).toBeUndefined();
  });

  it('round-trips a freeform arrowhead through export → import', async () => {
    const el: ShapeElement = {
      id: 'f', type: 'shape',
      frame: { x: 0, y: 0, w: 200, h: 100, rotation: 0 },
      data: {
        kind: 'freeform',
        path: { commands: [{ c: 'M', x: 0, y: 0 }, { c: 'C', x1: 0.3, y1: 1, x2: 0.7, y2: 1, x: 1, y: 0 }] },
        stroke: { color: { kind: 'srgb', value: '#292929' }, width: 1 },
        arrowheads: { end: { kind: 'triangle', size: 'md' } },
      },
    };
    const slideXml = `<?xml version="1.0"?>
      <p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
             xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
        <p:cSld><p:spTree>
          <p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
          <p:grpSpPr/>
          ${shapeToXml(el)}
        </p:spTree></p:cSld>
      </p:sld>`;
    const slide = await parseSlide({
      archive: makeArchive({ 'ppt/slides/slide1.xml': slideXml }),
      partPath: 'ppt/slides/slide1.xml',
      layoutMap: new Map(),
      scale: { sx: 1, sy: 1 },
      report: new ImportReport(),
      clrMap: new Map(),
    });
    const back = slide!.elements[0];
    expect(back.type).toBe('shape');
    if (back.type !== 'shape') return;
    expect(back.data.arrowheads?.end).toEqual({ kind: 'triangle', size: 'md' });
  });
});
