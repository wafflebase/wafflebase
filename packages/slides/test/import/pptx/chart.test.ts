// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { parseChartXml } from '../../../src/import/pptx/chart';
import { ImportReport } from '../../../src/import/pptx/report';
import { DEFAULT_WIDESCREEN_EMU, emuScale } from '../../../src/import/pptx/geometry';
import { parseXml } from '../../../src/import/pptx/xml';
import type { SlideParseContext } from '../../../src/import/pptx/shape';

const SCALE = emuScale(DEFAULT_WIDESCREEN_EMU);

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

const CHART_NS =
  'xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" ' +
  'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"';

const COLUMN_CLUSTERED = `<c:chartSpace ${CHART_NS}>
  <c:chart><c:plotArea>
    <c:barChart>
      <c:barDir val="col"/>
      <c:grouping val="clustered"/>
      <c:ser>
        <c:tx><c:strRef><c:strCache><c:pt idx="0"><c:v>Alpha</c:v></c:pt></c:strCache></c:strRef></c:tx>
        <c:spPr><a:solidFill><a:srgbClr val="3366CC"/></a:solidFill></c:spPr>
        <c:cat><c:strRef><c:strCache>
          <c:pt idx="0"><c:v>Q1</c:v></c:pt><c:pt idx="1"><c:v>Q2</c:v></c:pt>
        </c:strCache></c:strRef></c:cat>
        <c:val><c:numRef><c:numCache>
          <c:pt idx="0"><c:v>10</c:v></c:pt><c:pt idx="1"><c:v>20</c:v></c:pt>
        </c:numCache></c:numRef></c:val>
      </c:ser>
    </c:barChart>
  </c:plotArea></c:chart>
</c:chartSpace>`;

describe('parseChartXml — barChart', () => {
  it('maps a clustered column chart with cached values and color', () => {
    const data = parseChartXml(parseXml(COLUMN_CLUSTERED), ctx());
    expect(data).toBeDefined();
    expect(data!.kind).toBe('column');
    expect(data!.grouping).toBe('clustered');
    expect(data!.categories).toEqual(['Q1', 'Q2']);
    expect(data!.series).toHaveLength(1);
    expect(data!.series[0].name).toBe('Alpha');
    expect(data!.series[0].values).toEqual([10, 20]);
    expect(data!.series[0].color).toEqual({ kind: 'srgb', value: '#3366CC' });
  });

  it('maps barDir="bar" to kind "bar"', () => {
    const xml = COLUMN_CLUSTERED.replace('val="col"', 'val="bar"');
    const data = parseChartXml(parseXml(xml), ctx());
    expect(data!.kind).toBe('bar');
  });

  it('reads grouping="stacked"', () => {
    const xml = COLUMN_CLUSTERED.replace('val="clustered"', 'val="stacked"');
    const data = parseChartXml(parseXml(xml), ctx());
    expect(data!.grouping).toBe('stacked');
  });
});

const PIE = `<c:chartSpace ${CHART_NS}>
  <c:chart>
    <c:title><c:tx><c:rich><a:p><a:r><a:t>Share</a:t></a:r></a:p></c:rich></c:tx></c:title>
    <c:plotArea>
      <c:pieChart>
        <c:ser>
          <c:cat><c:strRef><c:strCache>
            <c:pt idx="0"><c:v>A</c:v></c:pt><c:pt idx="1"><c:v>B</c:v></c:pt>
          </c:strCache></c:strRef></c:cat>
          <c:val><c:numRef><c:numCache>
            <c:pt idx="0"><c:v>60</c:v></c:pt><c:pt idx="1"><c:v>40</c:v></c:pt>
          </c:numCache></c:numRef></c:val>
        </c:ser>
      </c:pieChart>
    </c:plotArea>
    <c:legend><c:legendPos val="r"/></c:legend>
  </c:chart>
</c:chartSpace>`;

describe('parseChartXml — line/area/pie + chart chrome', () => {
  it('maps a lineChart', () => {
    const xml = COLUMN_CLUSTERED
      .replace('<c:barChart>', '<c:lineChart>')
      .replace('</c:barChart>', '</c:lineChart>')
      .replace('<c:barDir val="col"/>', '');
    const data = parseChartXml(parseXml(xml), ctx());
    expect(data!.kind).toBe('line');
    expect(data!.series[0].values).toEqual([10, 20]);
  });

  it('maps an areaChart', () => {
    const xml = COLUMN_CLUSTERED
      .replace('<c:barChart>', '<c:areaChart>')
      .replace('</c:barChart>', '</c:areaChart>')
      .replace('<c:barDir val="col"/>', '');
    const data = parseChartXml(parseXml(xml), ctx());
    expect(data!.kind).toBe('area');
  });

  it('maps a pieChart with title and legend position', () => {
    const data = parseChartXml(parseXml(PIE), ctx());
    expect(data!.kind).toBe('pie');
    expect(data!.title).toBe('Share');
    expect(data!.legend).toBe('right');
    expect(data!.series[0].values).toEqual([60, 40]);
    expect(data!.categories).toEqual(['A', 'B']);
  });

  it('detects value-axis gridlines', () => {
    const xml = COLUMN_CLUSTERED.replace(
      '</c:plotArea>',
      '<c:valAx><c:majorGridlines/></c:valAx></c:plotArea>',
    );
    const data = parseChartXml(parseXml(xml), ctx());
    expect(data!.showGridlines).toBe(true);
  });
});
