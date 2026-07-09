import type { SlideParseContext } from './shape';
import { attr, attrInt, child, children, descendant } from './xml';
import type { ChartElement, ChartGrouping, ChartSeries } from '../../model/element';
import type { ThemeColor } from '../../model/theme';

export const CHART_URI =
  'http://schemas.openxmlformats.org/drawingml/2006/chart';

const GROUPINGS: ReadonlySet<string> = new Set([
  'clustered', 'stacked', 'percentStacked', 'standard',
]);

/** Read a `<c:*Cache>` (num or str) into a dense array indexed by `<c:pt idx>`. */
function readCache(cacheParent: Element | undefined): string[] {
  if (!cacheParent) return [];
  const pts = children(cacheParent, 'pt');
  const out: string[] = [];
  for (const pt of pts) {
    const idx = attrInt(pt, 'idx') ?? out.length;
    const v = child(pt, 'v')?.textContent ?? '';
    out[idx] = v;
  }
  // Fill holes so category/value alignment is positional.
  for (let i = 0; i < out.length; i++) if (out[i] === undefined) out[i] = '';
  return out;
}

/** A `<c:tx>`/`<c:cat>`/`<c:val>` wrapper → its cached string array. */
function cachedStrings(ref: Element | undefined): string[] {
  if (!ref) return [];
  const cache = descendant(ref, 'strCache') ?? descendant(ref, 'numCache');
  return readCache(cache);
}

/** Series solid-fill color → ThemeColor, or undefined for the accent cycle. */
function seriesColor(ser: Element): ThemeColor | undefined {
  const spPr = child(ser, 'spPr');
  const solid = spPr ? child(spPr, 'solidFill') : undefined;
  const srgb = solid ? child(solid, 'srgbClr') : undefined;
  const val = srgb ? attr(srgb, 'val') : undefined;
  if (val) return { kind: 'srgb', value: `#${val.toUpperCase()}` };
  // schemeClr resolution (theme reference) is a Phase-2 refinement; the
  // painter's accent cycle covers the common "no explicit color" case.
  return undefined;
}

function parseSeries(ser: Element): ChartSeries {
  const name = cachedStrings(child(ser, 'tx'))[0] || undefined;
  const valStrings = cachedStrings(child(ser, 'val'));
  const values = valStrings.map((s) => {
    if (s === '' || s == null) return null;
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  });
  const color = seriesColor(ser);
  return color ? { name, values, color } : { name, values };
}

function parseBarChart(
  plot: Element,
): ChartElement['data'] {
  const barDir = child(plot, 'barDir');
  const dir = (barDir ? attr(barDir, 'val') : undefined) ?? 'col';
  const kind = dir === 'bar' ? 'bar' : 'column';
  const groupingEl = child(plot, 'grouping');
  const groupingRaw = groupingEl ? attr(groupingEl, 'val') : undefined;
  const grouping: ChartGrouping | undefined =
    groupingRaw && GROUPINGS.has(groupingRaw)
      ? (groupingRaw as ChartGrouping)
      : undefined;
  const sers = children(plot, 'ser');
  const series = sers.map(parseSeries);
  // Guard child(sers[0], ...) since child does not accept undefined.
  const categories = cachedStrings(sers[0] ? child(sers[0], 'cat') : undefined);
  return { kind, grouping, categories, series };
}

const LEGEND_POS: Record<string, ChartElement['data']['legend']> = {
  t: 'top', b: 'bottom', l: 'left', r: 'right',
};

function parseCartesian(
  plot: Element,
  kind: 'line' | 'area',
): ChartElement['data'] {
  const groupingEl = child(plot, 'grouping');
  const groupingRaw = groupingEl ? attr(groupingEl, 'val') : undefined;
  const grouping =
    groupingRaw && GROUPINGS.has(groupingRaw)
      ? (groupingRaw as ChartGrouping)
      : undefined;
  const sers = children(plot, 'ser');
  const series = sers.map(parseSeries);
  // Guard child(sers[0], ...) since child does not accept undefined.
  const categories = cachedStrings(sers[0] ? child(sers[0], 'cat') : undefined);
  return { kind, grouping, categories, series };
}

function parsePieChart(plot: Element): ChartElement['data'] {
  const sers = children(plot, 'ser');
  const series = sers.map(parseSeries);
  const categories = cachedStrings(sers[0] ? child(sers[0], 'cat') : undefined);
  return { kind: 'pie', categories, series };
}

/**
 * Concatenate `<a:t>` runs under `<c:title>`. Walks via the local-name
 * `children`/`descendant` helpers (not raw `getElementsByTagName('a:t')`)
 * so the lookup stays namespace-agnostic, matching every other traversal
 * in this module.
 */
function parseTitle(chart: Element): string | undefined {
  const title = child(chart, 'title');
  if (!title) return undefined;
  const rich = descendant(title, 'rich') ?? descendant(title, 'tx');
  if (!rich) return undefined;
  const all = rich.getElementsByTagName('*');
  let text = '';
  for (let i = 0; i < all.length; i++) {
    if (all[i].localName === 't') text += all[i].textContent ?? '';
  }
  return text.trim() || undefined;
}

/**
 * Map a parsed `chartN.xml` Document to `ChartElement['data']`, or
 * `undefined` when the first plot family is not supported in Phase 1
 * (the caller then inserts a placeholder + bumps the report).
 * Frame/position is owned by the host `<p:graphicFrame>`, not here.
 */
export function parseChartXml(
  chartDoc: Document,
  ctx: SlideParseContext,
): ChartElement['data'] | undefined {
  void ctx; // reserved for schemeClr/theme resolution in Phase 2
  const chart = descendant(chartDoc, 'chart');
  const plotArea = chart ? child(chart, 'plotArea') : undefined;
  if (!chart || !plotArea) return undefined;

  let data: ChartElement['data'] | undefined;
  const bar = child(plotArea, 'barChart');
  const line = child(plotArea, 'lineChart');
  const area = child(plotArea, 'areaChart');
  const pie = child(plotArea, 'pieChart');
  if (bar) data = parseBarChart(bar);
  else if (line) data = parseCartesian(line, 'line');
  else if (area) data = parseCartesian(area, 'area');
  else if (pie) data = parsePieChart(pie);
  if (!data) return undefined; // unsupported family → caller placeholders

  const title = parseTitle(chart);
  if (title) data.title = title;

  const legendPosEl = descendant(chart, 'legendPos');
  const legendPos = legendPosEl ? attr(legendPosEl, 'val') : undefined;
  if (child(chart, 'legend')) {
    data.legend = (legendPos && LEGEND_POS[legendPos]) || 'bottom';
  }

  const valAx = descendant(plotArea, 'valAx');
  if (valAx && child(valAx, 'majorGridlines')) data.showGridlines = true;

  return data;
}
