// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { importPptx } from '../../../src/import/pptx/index';
import type { ChartElement, TextElement } from '../../../src/model/element';
import {
  buildChartDeckPptx,
  CHART_CATEGORIES,
  CHART_SERIES_NAME,
  CHART_TITLE,
  CHART_VALUES,
  SLIDE1_TEXT_CONTENT,
} from './__fixtures__/build-chart-deck-pptx';

/**
 * End-to-end proof that a chart on slide 2 of a real .pptx import survives
 * as a native `ChartElement` rather than being dropped (or flattened into
 * a table/placeholder). Every other chart test in this suite calls
 * `parseChartFrame`/`parseChartXml` directly; this is the only test that
 * drives the real `<p:graphicFrame>` → `graphicFrame` dispatcher
 * (`shape.ts`) through the full `importPptx` pipeline.
 */
describe('importPptx — chart on slide 2', () => {
  it('imports slide 2 chart as a ChartElement, not dropped', async () => {
    const buffer = await buildChartDeckPptx();
    const { document, report } = await importPptx(buffer);

    // Sanity: the deck parsed both slides.
    expect(document.slides).toHaveLength(2);

    // Slide 1 — plain text still imports (proves the deck itself is valid,
    // not just the chart path).
    const slide1 = document.slides[0];
    const textEl = slide1.elements.find((e) => e.type === 'text') as
      | TextElement
      | undefined;
    expect(textEl).toBeDefined();
    expect(textEl!.data.blocks[0].inlines.map((i) => i.text).join('')).toBe(
      SLIDE1_TEXT_CONTENT,
    );

    // Slide 2 — the graphicFrame must dispatch to parseChartFrame (chart
    // URI), not parseTable, and must not be dropped.
    const slide2 = document.slides[1];
    const chartEl = slide2.elements.find((e) => e.type === 'chart') as
      | ChartElement
      | undefined;
    expect(chartEl).toBeDefined();

    expect(chartEl!.data.kind).toBe('column');
    expect(chartEl!.data.grouping).toBe('clustered');
    expect(chartEl!.data.categories).toEqual(CHART_CATEGORIES);
    expect(chartEl!.data.series).toHaveLength(1);
    expect(chartEl!.data.series[0].name).toBe(CHART_SERIES_NAME);
    expect(chartEl!.data.series[0].values).toEqual(CHART_VALUES);
    expect(chartEl!.data.title).toBe(CHART_TITLE);
    expect(chartEl!.data.legend).toBe('bottom');

    // Frame position/size came from the graphicFrame's own <p:xfrm>, not a zeroed default.
    expect(chartEl!.frame.w).toBeGreaterThan(0);
    expect(chartEl!.frame.h).toBeGreaterThan(0);
    expect(chartEl!.frame.x).toBeGreaterThan(0);
    expect(chartEl!.frame.y).toBeGreaterThan(0);

    // The report must reflect a clean chart import, not a placeholder fallback.
    expect(report.importedCharts).toBe(1);
    expect(report.unsupportedCharts).toBe(0);
  });
});
