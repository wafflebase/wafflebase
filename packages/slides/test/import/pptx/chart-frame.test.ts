// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { parseChartFrame } from '../../../src/import/pptx/chart';
import { ImportReport } from '../../../src/import/pptx/report';
import { DEFAULT_WIDESCREEN_EMU, emuScale } from '../../../src/import/pptx/geometry';
import { parseXml } from '../../../src/import/pptx/xml';
import type { SlideParseContext } from '../../../src/import/pptx/shape';
import type { ChartElement } from '../../../src/model/element';

const SCALE = emuScale(DEFAULT_WIDESCREEN_EMU);

const CHART_XML = `<c:chartSpace
  xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"
  xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
  <c:chart><c:plotArea><c:barChart>
    <c:barDir val="col"/><c:grouping val="clustered"/>
    <c:ser>
      <c:cat><c:strRef><c:strCache><c:pt idx="0"><c:v>Q1</c:v></c:pt></c:strCache></c:strRef></c:cat>
      <c:val><c:numRef><c:numCache><c:pt idx="0"><c:v>7</c:v></c:pt></c:numCache></c:numRef></c:val>
    </c:ser>
  </c:barChart></c:plotArea></c:chart>
</c:chartSpace>`;

function ctx(report = new ImportReport()): SlideParseContext {
  return {
    archive: {
      readText: async (p: string) =>
        p === 'ppt/charts/chart1.xml' ? CHART_XML : undefined,
      readBytes: async () => undefined,
      list: () => [],
    },
    slidePartPath: 'ppt/slides/slide1.xml',
    rels: new Map([
      ['rId9', { type: '.../chart', target: '../charts/chart1.xml', external: false }],
    ]),
    scale: SCALE,
    report,
    idMap: new Map(),
    shapeKindByPptxId: new Map(),
    placeholderSizes: new Map(),
    clrMap: new Map(),
  };
}

const P = 'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
const A = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"';
const R = 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
const C = 'xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"';

function frame(inner: string): Element {
  return parseXml(`<root ${P} ${A} ${R} ${C}>${inner}</root>`)
    .documentElement.firstElementChild!;
}

const CHART_FRAME = frame(`<p:graphicFrame>
  <p:xfrm><a:off x="1000000" y="2000000"/><a:ext cx="4000000" cy="3000000"/></p:xfrm>
  <a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart">
    <c:chart r:id="rId9"/>
  </a:graphicData></a:graphic>
</p:graphicFrame>`);

// The chart rel id under a relationships-namespace prefix other than the
// conventional `r:` (some producers bind it differently). `getAttribute`
// on the literal `r:id` name misses this; only the namespace-aware
// `getAttributeNS(NS.R, 'id')` lookup resolves it, matching image.ts.
const CHART_FRAME_NS_PREFIX = frame(`<p:graphicFrame>
  <p:xfrm><a:off x="1000000" y="2000000"/><a:ext cx="4000000" cy="3000000"/></p:xfrm>
  <a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart">
    <c:chart xmlns:rel="http://schemas.openxmlformats.org/officeDocument/2006/relationships" rel:id="rId9"/>
  </a:graphicData></a:graphic>
</p:graphicFrame>`);

describe('parseChartFrame', () => {
  it('loads the chart part and returns a positioned ChartElement', async () => {
    const report = new ImportReport();
    const out = await parseChartFrame(CHART_FRAME, ctx(report));
    expect(out).toHaveLength(1);
    const el = out[0] as ChartElement;
    expect(el.type).toBe('chart');
    expect(el.data.kind).toBe('column');
    expect(el.data.series[0].values).toEqual([7]);
    expect(el.frame.w).toBeGreaterThan(0);
    expect(el.frame.x).toBeGreaterThan(0);
    expect(report.importedCharts).toBe(1);
  });

  it('returns a placeholder + bumps unsupportedCharts for an unknown family', async () => {
    const report = new ImportReport();
    const unknown = CHART_XML.replace(/barChart/g, 'radarChart');
    const c = ctx(report);
    c.archive.readText = async () => unknown;
    const out = await parseChartFrame(CHART_FRAME, c);
    expect(out).toHaveLength(1);
    expect(out[0].type).toBe('shape');
    expect(report.unsupportedCharts).toBe(1);
    expect(report.importedCharts).toBe(0);
  });

  it('falls back to a placeholder (not a throw) when the chart part XML is malformed', async () => {
    const report = new ImportReport();
    const c = ctx(report);
    c.archive.readText = async () => '<c:chartSpace><unclosed';
    const out = await parseChartFrame(CHART_FRAME, c);
    expect(out).toHaveLength(1);
    expect(out[0].type).toBe('shape');
    expect(report.unsupportedCharts).toBe(1);
    expect(report.importedCharts).toBe(0);
  });

  it('resolves a chart r:id bound to a non-"r" relationships-namespace prefix', async () => {
    const report = new ImportReport();
    const out = await parseChartFrame(CHART_FRAME_NS_PREFIX, ctx(report));
    expect(out).toHaveLength(1);
    expect(out[0].type).toBe('chart');
    expect(report.importedCharts).toBe(1);
  });
});
