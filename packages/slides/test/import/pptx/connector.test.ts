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
 * One target shape (`<p:sp>` id=10) plus four connectors, each anchored
 * to a distinct OOXML cxnLst index of the target. Used to assert that
 * `parseCxnSp` translates from OOXML's `T, L, B, R` ordering to
 * Waffle's `FOUR_CARDINAL` (`N, E, S, W`) ordering — i.e. indices
 * 1 (Left) and 3 (Right) must swap.
 */
function buildTreeWithCxnTargetingIdx(targetIdxs: number[]): string {
  const target = `<p:sp>
    <p:nvSpPr><p:cNvPr id="10" name="t"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
    <p:spPr>
      <a:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="914400"/></a:xfrm>
      <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
    </p:spPr>
  </p:sp>`;
  const connectors = targetIdxs
    .map(
      (idx, i) => `<p:cxnSp>
        <p:nvCxnSpPr>
          <p:cNvPr id="${100 + i}" name="c${i}"/>
          <p:cNvCxnSpPr>
            <a:stCxn id="10" idx="${idx}"/>
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
  it('remaps OOXML cxnLst indices (T, L, B, R) to Waffle FOUR_CARDINAL (N, E, S, W)', async () => {
    // PPTX:    0=T  1=L  2=B  3=R
    // Waffle:  0=N  1=E  2=S  3=W   (i.e. T, R, B, L)
    // Expected map: 0→0, 1→3, 2→2, 3→1.
    const tree = spTree(buildTreeWithCxnTargetingIdx([0, 1, 2, 3]));
    const elements = await parseSpTree(tree, ctx());
    const connectors = elements.filter(
      (e): e is ConnectorElement => e.type === 'connector',
    );
    expect(connectors).toHaveLength(4);

    const siteIndices = connectors.map((c) =>
      c.start.kind === 'attached' ? c.start.siteIndex : -1,
    );
    expect(siteIndices).toEqual([0, 3, 2, 1]);
  });
});
