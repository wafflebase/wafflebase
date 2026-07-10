import type { SlideParseContext } from './shape';
import { attr, attrInt, child, children, descendant, NS, parseXml } from './xml';
import { parseXfrm } from './geometry';
import { resolveRelsTarget } from './rels';
import { readAltText } from './effects';
import { generateId } from '../../model/element';
import type {
  ChartElement,
  ChartGrouping,
  ChartSeries,
  Element as SlideElement,
} from '../../model/element';
import type { ThemeColor } from '../../model/theme';

export const CHART_URI =
  'http://schemas.openxmlformats.org/drawingml/2006/chart';

const GROUPINGS: ReadonlySet<string> = new Set([
  'clustered', 'stacked', 'percentStacked', 'standard',
]);

/**
 * Read a `<c:*Cache>` (num or str) into a dense array indexed by
 * `<c:pt idx>`.
 *
 * `idx` comes straight from untrusted deck XML. A malformed/adversarial
 * `<c:pt idx="999999999">` must not become a raw array index — that would
 * allocate (and then hole-fill) an array with ~1e9 slots and hang the
 * tab. Any point whose idx is negative or exceeds a sane cap relative to
 * the number of points actually present is dropped instead of trusted;
 * the cap is `max(pts.length, 4096)`, generous headroom for legitimately
 * sparse caches while still bounding the allocation for hostile input.
 */
function readCache(cacheParent: Element | undefined): string[] {
  if (!cacheParent) return [];
  const pts = children(cacheParent, 'pt');
  const maxIdx = Math.max(pts.length, 4096);
  const pairs: Array<[number, string]> = [];
  let maxSeen = -1;
  for (const pt of pts) {
    const idx = attrInt(pt, 'idx') ?? pairs.length;
    if (idx < 0 || idx >= maxIdx) continue; // out-of-range idx: ignore, don't allocate for it
    const v = child(pt, 'v')?.textContent ?? '';
    pairs.push([idx, v]);
    if (idx > maxSeen) maxSeen = idx;
  }
  const out: string[] = new Array(maxSeen + 1).fill('');
  for (const [idx, v] of pairs) out[idx] = v;
  return out;
}

/** A `<c:tx>`/`<c:cat>`/`<c:val>` wrapper → its cached string array. */
function cachedStrings(ref: Element | undefined): string[] {
  if (!ref) return [];
  const cache = descendant(ref, 'strCache') ?? descendant(ref, 'numCache');
  return readCache(cache);
}

/**
 * Series name from `<c:tx>`. Usually a `<c:strRef>`/`<c:strCache>` (or
 * `<c:numCache>`) wrapper, but a series title can also be a literal
 * `<c:tx><c:v>Revenue</c:v></c:tx>` with no cache wrapper at all — fall
 * back to that direct `<c:v>` text so the legend doesn't show "Series 1".
 */
function seriesName(tx: Element | undefined): string | undefined {
  if (!tx) return undefined;
  const cached = cachedStrings(tx)[0];
  if (cached) return cached;
  return child(tx, 'v')?.textContent?.trim() || undefined;
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
  const name = seriesName(child(ser, 'tx'));
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
  // PowerPoint's default legend position is top-right; our model has no
  // corner positions, so map the corner to its closest edge.
  tr: 'right',
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

/**
 * Grey placeholder rect for a `<p:graphicFrame>` this importer can't
 * paint natively — an unsupported chart plot family, a missing/malformed
 * chart part, or (via `shape.ts`'s dispatcher) a non-chart, non-table
 * graphicData kind such as chartex, a diagram/SmartArt, or an OLE object.
 * Exported so `shape.ts` can reuse the exact same rect rather than
 * duplicating the literal.
 */
export function graphicFramePlaceholder(
  graphicFrame: Element,
  ctx: SlideParseContext,
): SlideElement {
  const xfrm = parseXfrm(child(graphicFrame, 'xfrm'), ctx.scale);
  return {
    id: generateId(),
    type: 'shape',
    frame: xfrm,
    data: {
      kind: 'rect',
      fill: { kind: 'srgb', value: '#E6E6E6' },
      stroke: { color: { kind: 'srgb', value: '#B0B0B0' }, width: 1 },
    },
  };
}

/**
 * Parse a `<p:graphicFrame>` whose `graphicData@uri` is the chart URI.
 * Resolves `<c:chart r:id>` → `ppt/charts/chartN.xml`, maps it, and
 * positions the resulting ChartElement with the frame's xfrm. Falls back
 * to a reported placeholder when the part is missing or the plot family
 * is unsupported.
 */
export async function parseChartFrame(
  graphicFrame: Element,
  ctx: SlideParseContext,
): Promise<SlideElement[]> {
  const chartRef = descendant(graphicFrame, 'chart');
  // Match image.ts's `parseBlipFill` technique: try the namespace-aware
  // lookup first so a deck that binds the relationships namespace to a
  // prefix other than the conventional `r:` still resolves, then fall
  // back to the literal `r:id` (and bare `id`) attribute names.
  const rid = chartRef
    ? chartRef.getAttributeNS(NS.R, 'id') ||
      attr(chartRef, 'r:id') ||
      attr(chartRef, 'id') ||
      undefined
    : undefined;
  const rel = rid ? ctx.rels.get(rid) : undefined;
  if (!rel) {
    ctx.report.unsupportedCharts++;
    return [graphicFramePlaceholder(graphicFrame, ctx)];
  }
  const partPath = resolveRelsTarget(ctx.slidePartPath, rel.target);
  // A missing part, malformed XML (parseXml throws on `<parsererror>`),
  // or any other unexpected failure while reading/mapping the chart part
  // must not abort the whole import — fall back to the same placeholder
  // path used for a missing/unsupported part.
  let data: ChartElement['data'] | undefined;
  try {
    const xml = await ctx.archive.readText(partPath);
    data = xml ? parseChartXml(parseXml(xml), ctx) : undefined;
  } catch {
    data = undefined;
  }
  if (!data) {
    ctx.report.unsupportedCharts++;
    return [graphicFramePlaceholder(graphicFrame, ctx)];
  }
  const xfrm = parseXfrm(child(graphicFrame, 'xfrm'), ctx.scale);
  const alt = readAltText(graphicFrame);
  if (alt) data.alt = alt;
  ctx.report.importedCharts++;
  return [{ id: generateId(), type: 'chart', frame: xfrm, data }];
}
