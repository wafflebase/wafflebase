// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { parseSpTree, type SlideParseContext } from '../../../src/import/pptx/shape';
import { ImportReport } from '../../../src/import/pptx/report';
import { DEFAULT_WIDESCREEN_EMU, emuScale } from '../../../src/import/pptx/geometry';
import { parseXml } from '../../../src/import/pptx/xml';
import type { ConnectorElement } from '../../../src/model/connector';

const SCALE = emuScale(DEFAULT_WIDESCREEN_EMU);

function spTree(xml: string): Element {
  return parseXml(
    `<root xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">${xml}</root>`,
  ).documentElement.firstElementChild!;
}

function ctx(): SlideParseContext {
  return {
    archive: {
      readText: async () => undefined,
      readBytes: async () => undefined,
      list: () => [],
    },
    slidePartPath: 'ppt/slides/slide1.xml',
    rels: new Map(),
    scale: SCALE,
    report: new ImportReport(),
    idMap: new Map(),
    shapeKindByPptxId: new Map(),
    placeholderSizes: new Map(),
    clrMap: new Map(),
  };
}

/**
 * One target shape (`<p:sp>` id=10) plus N connectors. `which` decides
 * whether each connector's *start* or *end* anchors to the target via
 * the given OOXML idx; the opposite endpoint is left free so the
 * connector survives the importer with both endpoints defined.
 */
function buildTree(
  which: 'stCxn' | 'endCxn',
  targetIdxs: number[],
  targetId = 10,
  targetPrst = 'roundRect',
): string {
  const target = `<p:sp>
    <p:nvSpPr><p:cNvPr id="${targetId}" name="t"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
    <p:spPr>
      <a:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="914400"/></a:xfrm>
      <a:prstGeom prst="${targetPrst}"><a:avLst/></a:prstGeom>
    </p:spPr>
  </p:sp>`;
  const connectors = targetIdxs
    .map(
      (idx, i) => `<p:cxnSp>
        <p:nvCxnSpPr>
          <p:cNvPr id="${100 + i}" name="c${i}"/>
          <p:cNvCxnSpPr>
            <a:${which} id="${targetId}" idx="${idx}"/>
          </p:cNvCxnSpPr>
          <p:nvPr/>
        </p:nvCxnSpPr>
        <p:spPr>
          <a:xfrm><a:off x="0" y="0"/><a:ext cx="100" cy="100"/></a:xfrm>
          <a:prstGeom prst="straightConnector1"><a:avLst/></a:prstGeom>
        </p:spPr>
      </p:cxnSp>`,
    )
    .join('');
  return `<p:spTree>
    <p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
    <p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>
    ${target}
    ${connectors}
  </p:spTree>`;
}

describe('parseCxnSp / attached endpoint site index', () => {
  // PPTX rect/roundRect cxnLst:  0=T  1=L  2=B  3=R
  // Waffle FOUR_CARDINAL:        0=N  1=E  2=S  3=W   (i.e. T, R, B, L)
  // Expected mapping:            0→0, 1→3, 2→2, 3→1.
  it('remaps OOXML cxnLst indices (T, L, B, R) to Waffle FOUR_CARDINAL on start endpoints', async () => {
    const elements = await parseSpTree(spTree(buildTree('stCxn', [0, 1, 2, 3])), ctx());
    const connectors = elements.filter(
      (e): e is ConnectorElement => e.type === 'connector',
    );
    expect(connectors).toHaveLength(4);
    const siteIndices = connectors.map((c) =>
      c.start.kind === 'attached' ? c.start.siteIndex : -1,
    );
    expect(siteIndices).toEqual([0, 3, 2, 1]);
  });

  it('remaps OOXML cxnLst indices on end endpoints', async () => {
    const elements = await parseSpTree(spTree(buildTree('endCxn', [0, 1, 2, 3])), ctx());
    const connectors = elements.filter(
      (e): e is ConnectorElement => e.type === 'connector',
    );
    expect(connectors).toHaveLength(4);
    const siteIndices = connectors.map((c) =>
      c.end.kind === 'attached' ? c.end.siteIndex : -1,
    );
    expect(siteIndices).toEqual([0, 3, 2, 1]);
  });

  // PPTX ellipse cxnLst is 8 connection points CCW from top:
  //   0=N  1=NW  2=W  3=SW  4=S  5=SE  6=E  7=NE
  // The Waffle override stores ELLIPSE_SITES in the same CCW order so the
  // OOXML idx is the site index verbatim — no remap needed.
  it('preserves OOXML cxnLst indices verbatim for ellipse targets', async () => {
    const elements = await parseSpTree(
      spTree(buildTree('endCxn', [0, 1, 2, 3, 4, 5, 6, 7], 10, 'ellipse')),
      ctx(),
    );
    const connectors = elements.filter(
      (e): e is ConnectorElement => e.type === 'connector',
    );
    expect(connectors).toHaveLength(8);
    const siteIndices = connectors.map((c) =>
      c.end.kind === 'attached' ? c.end.siteIndex : -1,
    );
    expect(siteIndices).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });

  // Slide 21 of the bug report: connector with `endCxn id=5 idx=2` on the
  // 8월 green ellipse should anchor at the LEFT-CENTER, not the bottom.
  // Pre-fix the rect-family remap mapped idx=2 to FOUR_CARDINAL[2]=S, so
  // the line terminated at the bottom of the circle.
  it('routes ellipse idx=2 to the W site (not S)', async () => {
    const elements = await parseSpTree(
      spTree(buildTree('endCxn', [2], 10, 'ellipse')),
      ctx(),
    );
    const connector = elements.find(
      (e): e is ConnectorElement => e.type === 'connector',
    );
    expect(connector).toBeDefined();
    expect(connector!.end.kind).toBe('attached');
    if (connector!.end.kind !== 'attached') return;
    // Site index 2 in ELLIPSE_SITES is the W cardinal point at
    // (x=0, y=0.5) with outward-normal pointing -x (DIR_W).
    const { getConnectionSites } = await import(
      '../../../src/view/canvas/connection-sites/index'
    );
    const targetEl = elements.find((e) => e.type === 'shape');
    expect(targetEl).toBeDefined();
    const sites = getConnectionSites(targetEl!);
    expect(sites).toHaveLength(8);
    const site = sites[connector!.end.siteIndex];
    expect(site.x).toBeCloseTo(0, 5);
    expect(site.y).toBeCloseTo(0.5, 5);
  });

  // Slide 10 of the bug report: two timeline arrows are free
  // `straightConnector1`s carrying BOTH flipH=1 and rot=10800000 (180°),
  // with a `tailEnd` triangle. On a horizontal line the flip and the 180°
  // rotation cancel, so the arrowhead must stay on the RIGHT (the `end`
  // endpoint). Pre-fix the importer applied flipH only and ignored the
  // rotation, resolving `end` to the left → arrowhead pointed left.
  it('composes flipH + 180° rotation so a horizontal connector keeps its direction', async () => {
    const tree = spTree(
      `<p:spTree>
        <p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
        <p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>
        <p:cxnSp>
          <p:nvCxnSpPr>
            <p:cNvPr id="100" name="c"/>
            <p:cNvCxnSpPr/>
            <p:nvPr/>
          </p:nvCxnSpPr>
          <p:spPr>
            <a:xfrm flipH="1" rot="10800000"><a:off x="1000000" y="2000000"/><a:ext cx="6000000" cy="0"/></a:xfrm>
            <a:prstGeom prst="straightConnector1"><a:avLst/></a:prstGeom>
            <a:ln><a:tailEnd type="triangle"/></a:ln>
          </p:spPr>
        </p:cxnSp>
      </p:spTree>`,
    );
    const elements = await parseSpTree(tree, ctx());
    const connector = elements.find(
      (e): e is ConnectorElement => e.type === 'connector',
    );
    expect(connector).toBeDefined();
    expect(connector!.start.kind).toBe('free');
    expect(connector!.end.kind).toBe('free');
    if (connector!.start.kind !== 'free' || connector!.end.kind !== 'free') return;
    // The arrowhead (tailEnd) is on `end`; it must sit to the RIGHT of the
    // start, at the box's right edge.
    expect(connector!.arrowheads.end?.kind).toBe('triangle');
    expect(connector!.end.x).toBeGreaterThan(connector!.start.x);
    expect(connector!.start.x).toBeCloseTo(1000000 * SCALE.sx, 3);
    expect(connector!.end.x).toBeCloseTo(7000000 * SCALE.sx, 3);
  });

  it('resolves a plain free connector start→end across the box diagonal', async () => {
    const tree = spTree(
      `<p:spTree>
        <p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
        <p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>
        <p:cxnSp>
          <p:nvCxnSpPr>
            <p:cNvPr id="100" name="c"/>
            <p:cNvCxnSpPr/>
            <p:nvPr/>
          </p:nvCxnSpPr>
          <p:spPr>
            <a:xfrm><a:off x="1000000" y="2000000"/><a:ext cx="6000000" cy="500000"/></a:xfrm>
            <a:prstGeom prst="straightConnector1"><a:avLst/></a:prstGeom>
          </p:spPr>
        </p:cxnSp>
      </p:spTree>`,
    );
    const elements = await parseSpTree(tree, ctx());
    const connector = elements.find(
      (e): e is ConnectorElement => e.type === 'connector',
    );
    expect(connector).toBeDefined();
    if (connector!.start.kind !== 'free' || connector!.end.kind !== 'free') return;
    expect(connector!.start.x).toBeCloseTo(1000000 * SCALE.sx, 3);
    expect(connector!.start.y).toBeCloseTo(2000000 * SCALE.sy, 3);
    expect(connector!.end.x).toBeCloseTo(7000000 * SCALE.sx, 3);
    expect(connector!.end.y).toBeCloseTo(2500000 * SCALE.sy, 3);
  });

  it('returns a free endpoint when stCxn id has no matching sp', async () => {
    // Tree contains the connector but not the referenced target shape.
    const tree = spTree(
      `<p:spTree>
        <p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
        <p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>
        <p:cxnSp>
          <p:nvCxnSpPr>
            <p:cNvPr id="100" name="c"/>
            <p:cNvCxnSpPr><a:stCxn id="999" idx="1"/></p:cNvCxnSpPr>
            <p:nvPr/>
          </p:nvCxnSpPr>
          <p:spPr>
            <a:xfrm><a:off x="0" y="0"/><a:ext cx="100" cy="100"/></a:xfrm>
            <a:prstGeom prst="straightConnector1"><a:avLst/></a:prstGeom>
          </p:spPr>
        </p:cxnSp>
      </p:spTree>`,
    );
    const elements = await parseSpTree(tree, ctx());
    const connectors = elements.filter(
      (e): e is ConnectorElement => e.type === 'connector',
    );
    expect(connectors).toHaveLength(1);
    // No matching sp → resolveEndpoint must collapse to free corner.
    expect(connectors[0].start.kind).toBe('free');
  });
});
