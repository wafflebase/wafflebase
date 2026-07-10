// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { parseSpTree } from '../../../src/import/pptx/shape';
import { ImportReport } from '../../../src/import/pptx/report';
import { DEFAULT_WIDESCREEN_EMU, emuScale } from '../../../src/import/pptx/geometry';
import { parseXml } from '../../../src/import/pptx/xml';
import type { SlideParseContext } from '../../../src/import/pptx/shape';

const SCALE = emuScale(DEFAULT_WIDESCREEN_EMU);

const P = 'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
const A = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"';
const R = 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';

function spTree(inner: string): Element {
  return parseXml(`<p:spTree ${P} ${A} ${R}>${inner}</p:spTree>`).documentElement;
}

function ctx(report = new ImportReport()): SlideParseContext {
  return {
    archive: { readText: async () => undefined, readBytes: async () => undefined, list: () => [] },
    slidePartPath: 'ppt/slides/slide1.xml',
    rels: new Map(),
    scale: SCALE,
    report,
    idMap: new Map(),
    shapeKindByPptxId: new Map(),
    placeholderSizes: new Map(),
    clrMap: new Map(),
  };
}

// The 2014 "chart extensions" namespace used by waterfall/histogram/box/
// funnel/treemap/sunburst charts — a distinct part type from the classic
// CHART_URI this importer already supports.
const CHARTEX_URI = 'http://schemas.microsoft.com/office/drawing/2014/chartex';

const CHARTEX_FRAME = `<p:graphicFrame>
  <p:xfrm><a:off x="1000000" y="2000000"/><a:ext cx="4000000" cy="3000000"/></p:xfrm>
  <a:graphic><a:graphicData uri="${CHARTEX_URI}">
    <cx:chart xmlns:cx="${CHARTEX_URI}" r:id="rId9"/>
  </a:graphicData></a:graphic>
</p:graphicFrame>`;

const TABLE_FRAME = `<p:graphicFrame>
  <p:xfrm><a:off x="0" y="0"/><a:ext cx="2000000" cy="1000000"/></p:xfrm>
  <a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table">
    <a:tbl>
      <a:tblGrid><a:gridCol w="2000000"/></a:tblGrid>
      <a:tr h="1000000">
        <a:tc><a:txBody><a:bodyPr/><a:p><a:r><a:t>Hi</a:t></a:r></a:p></a:txBody></a:tc>
      </a:tr>
    </a:tbl>
  </a:graphicData></a:graphic>
</p:graphicFrame>`;

describe('graphicFrame dispatch — chartex/diagram vs table', () => {
  it('placeholders a chartex (2014 chart-extension) frame and counts it as unsupported', async () => {
    const report = new ImportReport();
    const out = await parseSpTree(spTree(CHARTEX_FRAME), ctx(report));
    expect(out).toHaveLength(1);
    expect(out[0].type).toBe('shape');
    expect(report.unsupportedCharts).toBe(1);
  });

  it('still imports a real table and does not bump unsupportedCharts', async () => {
    const report = new ImportReport();
    const out = await parseSpTree(spTree(TABLE_FRAME), ctx(report));
    expect(out).toHaveLength(1);
    expect(out[0].type).toBe('table');
    expect(report.unsupportedCharts).toBe(0);
  });
});
