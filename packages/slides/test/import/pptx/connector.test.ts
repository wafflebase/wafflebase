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
): string {
  const target = `<p:sp>
    <p:nvSpPr><p:cNvPr id="${targetId}" name="t"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
    <p:spPr>
      <a:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="914400"/></a:xfrm>
      <a:prstGeom prst="roundRect"><a:avLst/></a:prstGeom>
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
