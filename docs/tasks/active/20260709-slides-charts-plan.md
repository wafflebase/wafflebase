# Slides Charts (Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make PPTX charts survive import as a native, Canvas-painted `ChartElement` in `@wafflebase/slides` (import + render + PDF), instead of being silently dropped.

**Architecture:** A new `ChartElement` (`type: 'chart'`) joins the six-member `Element` union. The PPTX importer disambiguates `<p:graphicFrame>` by its `graphicData/@uri`: tables keep going to `parseTable`, charts route to a new `parseChart` that reads frozen `<c:numCache>`/`<c:strCache>` values + theme colors from `ppt/charts/chartN.xml`, and everything else becomes a reported grey placeholder. A Canvas 2D painter (`chart-renderer.ts`) draws the element in local coords, so editor, thumbnail, and PDF export (which reuse `drawSlide`) are all consistent for free.

**Tech Stack:** TypeScript, Vitest (jsdom), DOMParser-based OOXML parsing (`src/import/pptx/xml.ts` helpers), Canvas 2D API, existing `ctx-spy` test double.

## Global Constraints

- **Design doc:** `docs/design/slides/slides-charts.md` (already committed). Keep the code and doc in sync.
- **Package:** all code under `packages/slides/`. Tests under `packages/slides/test/`, mirroring `src/` paths.
- **Element color type is `ThemeColor`** (from `src/model/theme.ts`), resolved with `resolveColor(color, theme)`. There is NO `StoredColor` type — the design doc's `StoredColor` label means `ThemeColor`.
- **Chart families in scope:** `column`, `bar`, `line`, `area`, `pie`, with grouping `clustered` / `stacked` / `percentStacked` / `standard`. Any other plot element → placeholder + report counter, never dropped.
- **No editing, no PPTX export, no CRDT chart-data editing** in Phase 1.
- **`clone.ts` is a generic JSON deep-clone** — no per-type change needed. **`migrate.ts` needs no change** — it only special-cases `shape`; charts appear only via new imports.
- **Test env:** import-parser tests use `// @vitest-environment jsdom` (DOMParser). Painter tests import `../../../src/view/canvas/test-canvas-env` (installs `Path2D`) and use `createCtxSpy` / `asCtx` from `src/view/canvas/ctx-spy`.
- **Commit style:** subject ≤70 chars, blank line 2, body explains why. Run `pnpm --filter @wafflebase/slides test` (or `pnpm test`) green before each commit.

---

### Task 1: `ChartElement` model type

**Files:**
- Modify: `packages/slides/src/model/element.ts` (union at `:560`, `ElementInit` at `:571`; add new types near `TableElement` at `:527`)
- Test: `packages/slides/test/model/chart-element.test.ts`

**Interfaces:**
- Consumes: `ElementBase` (`{ id; frame; placeholderRef? }`), `Frame`, `ThemeColor`, `Effects` — all already in `element.ts` / imported there.
- Produces:
  - `type ChartKind = 'column' | 'bar' | 'line' | 'area' | 'pie'`
  - `type ChartGrouping = 'clustered' | 'stacked' | 'percentStacked' | 'standard'`
  - `type ChartLegendPos = 'top' | 'bottom' | 'left' | 'right' | 'none'`
  - `interface ChartSeries { name?: string; values: (number | null)[]; color?: ThemeColor }`
  - `ChartElement = ElementBase & { type: 'chart'; data: { kind: ChartKind; grouping?: ChartGrouping; title?: string; categories: string[]; series: ChartSeries[]; legend?: ChartLegendPos; showGridlines?: boolean; alt?: string; effects?: Effects } }`
  - `ChartElement` added to both `Element` and `ElementInit` unions.

- [ ] **Step 1: Write the failing test**

Create `packages/slides/test/model/chart-element.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { ChartElement, Element } from '../../src/model/element';
import { clone } from '../../src/model/clone';

const CHART: ChartElement = {
  id: 'c1',
  type: 'chart',
  frame: { x: 10, y: 20, w: 300, h: 200, rotation: 0 },
  data: {
    kind: 'column',
    grouping: 'clustered',
    title: 'Revenue',
    categories: ['Q1', 'Q2'],
    series: [
      { name: 'A', values: [1, 2], color: { kind: 'srgb', value: '#3366cc' } },
      { name: 'B', values: [3, null] },
    ],
    legend: 'bottom',
    showGridlines: true,
  },
};

describe('ChartElement', () => {
  it('is assignable to the Element union', () => {
    const el: Element = CHART;
    expect(el.type).toBe('chart');
  });

  it('deep-clones without shared references', () => {
    const copy = clone(CHART);
    expect(copy).toEqual(CHART);
    expect(copy.data.series).not.toBe(CHART.data.series);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @wafflebase/slides test -- chart-element`
Expected: FAIL — TypeScript error, `'chart'` not assignable to `Element` (union has no chart member).

- [ ] **Step 3: Add the types**

In `packages/slides/src/model/element.ts`, after the `TableElement` block (ends `:558`), add:

```ts
export type ChartKind = 'column' | 'bar' | 'line' | 'area' | 'pie';

export type ChartGrouping =
  | 'clustered'
  | 'stacked'
  | 'percentStacked'
  | 'standard';

export type ChartLegendPos = 'top' | 'bottom' | 'left' | 'right' | 'none';

/** One data series in a chart. `values` is a frozen snapshot from the
 * PPTX `<c:numCache>` (null = a blank point). `color` comes from the
 * series `<c:spPr>` solid fill; absent ⇒ painter uses the theme accent
 * cycle by series index. */
export type ChartSeries = {
  name?: string;
  values: (number | null)[];
  color?: ThemeColor;
};

/**
 * Data-driven chart imported from a PPTX `<p:graphicFrame>/<c:chart>`.
 * Self-contained (values live on the element) because a slide has no
 * backing workbook — the numbers are PowerPoint's last cached render.
 * Phase 1 is import + paint + PDF only; not editable in-app.
 */
export type ChartElement = ElementBase & {
  type: 'chart';
  data: {
    kind: ChartKind;
    /** bar/area only; ignored for line/pie. Absent ⇒ 'clustered'. */
    grouping?: ChartGrouping;
    title?: string;
    /** Shared category-axis labels (x for column/line/area, y for bar). */
    categories: string[];
    series: ChartSeries[];
    /** Absent ⇒ painter default ('bottom' when >1 series, else 'none'). */
    legend?: ChartLegendPos;
    showGridlines?: boolean;
    /** Screen-reader description ↔ `<p:cNvPr descr>`. */
    alt?: string;
    /** Paint-time effects (drop shadow / reflection). */
    effects?: Effects;
  };
};
```

Then add `ChartElement` to both unions:

```ts
export type Element =
  | TextElement
  | ImageElement
  | ShapeElement
  | ConnectorElement
  | GroupElement
  | TableElement
  | ChartElement;
```

```ts
export type ElementInit =
  | Omit<TextElement, 'id'>
  | Omit<ImageElement, 'id'>
  | Omit<ShapeElement, 'id'>
  | Omit<ConnectorElement, 'id'>
  | Omit<GroupElement, 'id'>
  | Omit<TableElement, 'id'>
  | Omit<ChartElement, 'id'>;
```

(`Effects` is already imported/defined in this file — it's used by `TableElement`.)

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @wafflebase/slides test -- chart-element`
Expected: PASS (2 tests).

- [ ] **Step 5: Typecheck the package**

Run: `pnpm --filter @wafflebase/slides build` (or the package's typecheck script)
Expected: no type errors. If a `switch (element.type)` elsewhere is now non-exhaustive, note it — Task 5 handles the renderer switch; any other exhaustiveness break is fixed in the task that owns that file.

- [ ] **Step 6: Commit**

```bash
git add packages/slides/src/model/element.ts packages/slides/test/model/chart-element.test.ts
git commit -m "Add ChartElement to the slides model"
```

---

### Task 2: `parseChart` — column/bar with grouping

**Files:**
- Create: `packages/slides/src/import/pptx/chart.ts`
- Test: `packages/slides/test/import/pptx/chart.test.ts`

**Interfaces:**
- Consumes: `SlideParseContext` (from `src/import/pptx/shape.ts` — has `archive`, `slidePartPath`, `rels`, `scale`, `report`, `clrMap`, `idMap`, …); xml helpers `parseXml`, `child`, `children`, `descendant`, `attr`, `attrInt` (from `src/import/pptx/xml.ts`); `parseXfrm` + `EmuScale` (from `src/import/pptx/geometry.ts`, same import `table.ts` uses); `resolveRelsTarget` (from `src/import/pptx/rels.ts`); `generateId`, `ChartElement`, `ChartSeries` (from `src/model/element.ts`).
- Produces:
  - `parseChartXml(chartDoc: Document, ctx: SlideParseContext): ChartElement['data'] | undefined` — pure mapper over a parsed `chartN.xml` Document; returns `undefined` for an unsupported plot family. **Frame is NOT set here** (the graphicFrame owns position); this returns only `data`.
  - `CHART_URI = 'http://schemas.openxmlformats.org/drawingml/2006/chart'` (exported const).

This task implements only `barChart` (column + bar) mapping; Task 3 extends the same function for line/area/pie. Splitting keeps each test cycle small.

- [ ] **Step 1: Write the failing test**

Create `packages/slides/test/import/pptx/chart.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @wafflebase/slides test -- import/pptx/chart`
Expected: FAIL — cannot find module `../../../src/import/pptx/chart`.

- [ ] **Step 3: Implement `chart.ts` (barChart path)**

Create `packages/slides/src/import/pptx/chart.ts`:

```ts
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
  const dir = attr(child(plot, 'barDir'), 'val') ?? 'col';
  const kind = dir === 'bar' ? 'bar' : 'column';
  const groupingRaw = attr(child(plot, 'grouping'), 'val');
  const grouping: ChartGrouping | undefined =
    groupingRaw && GROUPINGS.has(groupingRaw)
      ? (groupingRaw as ChartGrouping)
      : undefined;
  const sers = children(plot, 'ser');
  const series = sers.map(parseSeries);
  const categories = cachedStrings(child(sers[0], 'cat'));
  return { kind, grouping, categories, series };
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
  const plotArea = descendant(chartDoc, 'plotArea');
  if (!plotArea) return undefined;
  const bar = child(plotArea, 'barChart');
  if (bar) return parseBarChart(bar);
  // line/area/pie added in Task 3; other families → placeholder (Task 4).
  return undefined;
}
```

Note: `child(sers[0], 'cat')` is safe when `sers` is empty because `child(undefined, ...)` is guarded — verify `xml.ts:child` accepts `undefined`. If it does not, guard with `sers[0] ? child(sers[0], 'cat') : undefined`. (Check `src/import/pptx/xml.ts:37`.)

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @wafflebase/slides test -- import/pptx/chart`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/slides/src/import/pptx/chart.ts packages/slides/test/import/pptx/chart.test.ts
git commit -m "Parse PPTX barChart into ChartElement data"
```

---

### Task 3: `parseChart` — line/area/pie + title/legend/gridlines

**Files:**
- Modify: `packages/slides/src/import/pptx/chart.ts`
- Test: `packages/slides/test/import/pptx/chart.test.ts` (append cases)

**Interfaces:**
- Consumes: everything from Task 2.
- Produces: `parseChartXml` now also handles `lineChart`, `areaChart`, `pieChart`, and populates `title`, `legend`, `showGridlines` for all families. No signature change.

- [ ] **Step 1: Write the failing tests (append)**

Add to `packages/slides/test/import/pptx/chart.test.ts`:

```ts
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
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @wafflebase/slides test -- import/pptx/chart`
Expected: FAIL — line/area/pie return `undefined`; no title/legend/gridlines.

- [ ] **Step 3: Extend `chart.ts`**

Add helpers and generalize `parseChartXml`:

```ts
const LEGEND_POS: Record<string, ChartElement['data']['legend']> = {
  t: 'top', b: 'bottom', l: 'left', r: 'right',
};

function parseCartesian(
  plot: Element,
  kind: 'line' | 'area',
): ChartElement['data'] {
  const groupingRaw = attr(child(plot, 'grouping'), 'val');
  const grouping =
    groupingRaw && GROUPINGS.has(groupingRaw)
      ? (groupingRaw as ChartGrouping)
      : undefined;
  const sers = children(plot, 'ser');
  const series = sers.map(parseSeries);
  const categories = sers[0] ? cachedStrings(child(sers[0], 'cat')) : [];
  return { kind, grouping, categories, series };
}

function parsePieChart(plot: Element): ChartElement['data'] {
  const sers = children(plot, 'ser');
  const series = sers.map(parseSeries);
  const categories = sers[0] ? cachedStrings(child(sers[0], 'cat')) : [];
  return { kind: 'pie', categories, series };
}

/** Concatenate `<a:t>` runs under `<c:title>`. */
function parseTitle(chart: Element): string | undefined {
  const title = child(chart, 'title');
  if (!title) return undefined;
  const rich = descendant(title, 'rich') ?? descendant(title, 'tx');
  if (!rich) return undefined;
  const text = children(rich, 't').length
    ? children(rich, 't').map((t) => t.textContent ?? '').join('')
    : Array.from(rich.getElementsByTagName('a:t'))
        .map((t) => t.textContent ?? '')
        .join('');
  return text.trim() || undefined;
}
```

Then rewrite the bottom of `parseChartXml`:

```ts
export function parseChartXml(
  chartDoc: Document,
  ctx: SlideParseContext,
): ChartElement['data'] | undefined {
  void ctx;
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

  const legendPos = attr(descendant(chart, 'legendPos'), 'val');
  if (child(chart, 'legend')) {
    data.legend = (legendPos && LEGEND_POS[legendPos]) || 'bottom';
  }

  const valAx = descendant(plotArea, 'valAx');
  if (valAx && child(valAx, 'majorGridlines')) data.showGridlines = true;

  return data;
}
```

Note: `descendant` uses local-name matching per `xml.ts`, so `getElementsByTagName('a:t')` in `parseTitle` may need the local-name form — prefer the existing `children(rich, 't')` / `descendant` helpers over raw DOM. Adjust `parseTitle` to walk `descendant`/`children` only if `getElementsByTagName` returns nothing under jsdom (verify against the `PIE` fixture).

- [ ] **Step 4: Run to verify pass**

Run: `pnpm --filter @wafflebase/slides test -- import/pptx/chart`
Expected: PASS (all Task 2 + Task 3 cases).

- [ ] **Step 5: Commit**

```bash
git add packages/slides/src/import/pptx/chart.ts packages/slides/test/import/pptx/chart.test.ts
git commit -m "Parse line/area/pie charts + title, legend, gridlines"
```

---

### Task 4: graphicFrame dispatch + placeholder + report counters

**Files:**
- Modify: `packages/slides/src/import/pptx/shape.ts` (`case 'graphicFrame'` at `:383`)
- Modify: `packages/slides/src/import/pptx/report.ts` (add counters + summary lines)
- Create helper in `chart.ts`: `parseChartFrame(graphicFrame, ctx): Promise<SlideElement[]>`
- Test: `packages/slides/test/import/pptx/chart-frame.test.ts`

**Interfaces:**
- Consumes: `parseChartXml`, `CHART_URI` (Task 2/3); `parseXfrm` + scale (as in `table.ts`); `resolveRelsTarget` + `ctx.rels` + `ctx.archive.readText` + `parseXml`; `generateId`; `readAltText` (already used in `table.ts`).
- Produces:
  - `parseChartFrame(graphicFrame: Element, ctx: SlideParseContext): Promise<SlideElement[]>` — resolves the `<c:chart r:id>` to `ppt/charts/chartN.xml`, reads + parses it, returns `[ChartElement]`; on unsupported family or missing part, returns `[placeholderRect]` and bumps `ctx.report.unsupportedCharts`; bumps `ctx.report.importedCharts` on success.
  - `report.ts`: `importedCharts = 0`, `unsupportedCharts = 0`, with summary lines.

- [ ] **Step 1: Write the failing test**

Create `packages/slides/test/import/pptx/chart-frame.test.ts`:

```ts
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
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @wafflebase/slides test -- import/pptx/chart-frame`
Expected: FAIL — `parseChartFrame` not exported; `importedCharts`/`unsupportedCharts` not on `ImportReport`.

- [ ] **Step 3: Add report counters**

In `packages/slides/src/import/pptx/report.ts`, add fields after `transitionsApproximated`:

```ts
  /** Charts imported as native ChartElement. */
  importedCharts = 0;
  /** Chart frames whose plot family is unsupported → placeholder box. */
  unsupportedCharts = 0;
```

And in `summary()`, before the `animation*` block:

```ts
    if (this.importedCharts) parts.push(`${this.importedCharts} chart(s) imported`);
    if (this.unsupportedCharts)
      parts.push(`${this.unsupportedCharts} chart(s) unsupported → placeholder`);
```

- [ ] **Step 4: Add `parseChartFrame` to `chart.ts`**

Add these imports at the top of `chart.ts`:

```ts
import { parseXml } from './xml';
import { parseXfrm } from './geometry';
import { resolveRelsTarget } from './rels';
import { readAltText } from './effects'; // same source table.ts uses
import { generateId } from '../../model/element';
import type { SlideElement } from './shape'; // the importer's element alias
```

(Confirm `readAltText`'s module — `table.ts` imports it; reuse that exact import path. Confirm `SlideElement` alias export from `shape.ts`; `table.ts` returns `SlideElement[]`.)

Append:

```ts
/** Grey placeholder rect for a chart family Phase 1 can't paint. */
function chartPlaceholder(
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
  } as SlideElement;
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
  const rid =
    chartRef?.getAttribute('r:id') ?? chartRef?.getAttribute('id') ?? undefined;
  const rel = rid ? ctx.rels.get(rid) : undefined;
  if (!rel) {
    ctx.report.unsupportedCharts++;
    return [chartPlaceholder(graphicFrame, ctx)];
  }
  const partPath = resolveRelsTarget(ctx.slidePartPath, rel.target);
  const xml = await ctx.archive.readText(partPath);
  const data = xml ? parseChartXml(parseXml(xml), ctx) : undefined;
  if (!data) {
    ctx.report.unsupportedCharts++;
    return [chartPlaceholder(graphicFrame, ctx)];
  }
  const xfrm = parseXfrm(child(graphicFrame, 'xfrm'), ctx.scale);
  const alt = readAltText(graphicFrame);
  if (alt) data.alt = alt;
  ctx.report.importedCharts++;
  return [{ id: generateId(), type: 'chart', frame: xfrm, data }];
}
```

Note on `r:id`: jsdom's `getAttribute('r:id')` works because the attribute's qualified name is literally `r:id`. If it returns null under the parser, fall back to scanning `chartRef.attributes` for a local name `id` in the relationships namespace. Verify against the `CHART_FRAME` fixture in Step 1 (the test will catch it).

- [ ] **Step 5: Wire the dispatcher**

In `packages/slides/src/import/pptx/shape.ts`, replace `case 'graphicFrame': return parseTable(el, ctx);` (`:383`) with URI-based routing:

```ts
    case 'graphicFrame': {
      const gd = descendant(el, 'graphicData');
      const uri = gd ? gd.getAttribute('uri') ?? '' : '';
      if (uri === CHART_URI) return parseChartFrame(el, ctx);
      return parseTable(el, ctx);
    }
```

Add imports to `shape.ts`: `import { parseChartFrame, CHART_URI } from './chart';` and ensure `descendant` is imported from `./xml` (it is used elsewhere; verify). `parseChild` is already `async` and awaits chart results.

- [ ] **Step 6: Run tests to verify pass**

Run: `pnpm --filter @wafflebase/slides test -- import/pptx`
Expected: PASS — chart-frame (2) + chart (all) + existing table/shape suites unaffected.

- [ ] **Step 7: Commit**

```bash
git add packages/slides/src/import/pptx/chart.ts packages/slides/src/import/pptx/shape.ts packages/slides/src/import/pptx/report.ts packages/slides/test/import/pptx/chart-frame.test.ts
git commit -m "Route chart graphicFrames to parseChart with placeholder fallback"
```

---

### Task 5: Canvas painter — axes + column/bar

**Files:**
- Create: `packages/slides/src/view/canvas/chart-renderer.ts`
- Modify: `packages/slides/src/view/canvas/element-renderer.ts` (`switch` at `:260`)
- Test: `packages/slides/test/view/canvas/chart-renderer.test.ts`

**Interfaces:**
- Consumes: `ChartElement`, `Theme`, `resolveColor` (`src/model/theme.ts`); `createCtxSpy`, `asCtx` (`src/view/canvas/ctx-spy`); `test-canvas-env`. Mirrors `drawTable(ctx, size, data, theme, opts)`.
- Produces:
  - `drawChart(ctx: CanvasRenderingContext2D, size: { w: number; h: number }, data: ChartElement['data'], theme: Theme, opts?: { fontScale?: number }): void`
  - `ACCENT_ROLES: readonly ColorRole[]` = `['accent1'..'accent6']`, and `seriesColorAt(data, i, theme): string` (exported for reuse/testing).
  - `niceTicks(max: number, count?: number): { max: number; step: number }` (exported, pure, unit-tested).

This task paints column/bar only; Task 6 adds line/area/pie in the same file.

- [ ] **Step 1: Write the failing tests**

Create `packages/slides/test/view/canvas/chart-renderer.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import '../../../src/view/canvas/test-canvas-env';
import { asCtx, createCtxSpy } from '../../../src/view/canvas/ctx-spy';
import { drawChart, niceTicks } from '../../../src/view/canvas/chart-renderer';
import type { ChartElement } from '../../../src/model/element';
import type { Theme } from '../../../src/model/theme';

const THEME: Theme = {
  id: 't', name: 't',
  colors: {
    text: '#000', background: '#fff', textSecondary: '#444', backgroundAlt: '#f3f3f3',
    accent1: '#3366cc', accent2: '#dc3912', accent3: '#ff9900', accent4: '#109618',
    accent5: '#990099', accent6: '#0099c6',
    hyperlink: '#11c', visitedHyperlink: '#71a',
  },
  fonts: { heading: 'Inter', body: 'Inter' },
};

const size = { w: 400, h: 300 };

const columnData = (): ChartElement['data'] => ({
  kind: 'column',
  grouping: 'clustered',
  categories: ['Q1', 'Q2', 'Q3'],
  series: [
    { name: 'A', values: [1, 2, 3] },
    { name: 'B', values: [3, 2, 1] },
  ],
});

describe('niceTicks', () => {
  it('rounds the axis max up to a nice step', () => {
    expect(niceTicks(23).max).toBeGreaterThanOrEqual(23);
    expect(niceTicks(23).step).toBeGreaterThan(0);
  });
  it('handles an all-zero domain without NaN', () => {
    const t = niceTicks(0);
    expect(Number.isFinite(t.max)).toBe(true);
    expect(Number.isFinite(t.step)).toBe(true);
  });
});

describe('drawChart — column', () => {
  it('draws one filled rect per (series × category) bar', () => {
    const ctx = createCtxSpy();
    drawChart(asCtx(ctx), size, columnData(), THEME);
    // 2 series × 3 categories = 6 bars.
    expect(ctx.fillRect).toHaveBeenCalledTimes(6);
  });

  it('does not throw on empty series', () => {
    const ctx = createCtxSpy();
    expect(() =>
      drawChart(asCtx(ctx), size, { kind: 'column', categories: [], series: [] }, THEME),
    ).not.toThrow();
  });
});
```

If `createCtxSpy` does not spy `fillRect`, assert on `ctx.fill` (Path2D rects) instead — inspect `src/view/canvas/ctx-spy.ts` first and match its recorded methods. Use whichever primitive the painter actually calls.

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @wafflebase/slides test -- chart-renderer`
Expected: FAIL — module `chart-renderer` not found.

- [ ] **Step 3: Implement `chart-renderer.ts` (axes + bars)**

Create `packages/slides/src/view/canvas/chart-renderer.ts`. Paint in local coords (`0..size.w × 0..size.h`). Reserve margins for axis labels/legend/title; compute a value domain; for `clustered` place `series.length` bars per category slot, for `stacked`/`percentStacked` accumulate. Use `ctx.fillRect` for bars, `ctx.strokeStyle`/`ctx.beginPath`+`moveTo`/`lineTo`+`stroke` for axes and gridlines. Resolve each series color via `seriesColorAt`.

```ts
import type { ChartElement } from '../../model/element';
import type { ColorRole, Theme } from '../../model/theme';
import { resolveColor } from '../../model/theme';

export const ACCENT_ROLES: readonly ColorRole[] = [
  'accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6',
];

export function seriesColorAt(
  data: ChartElement['data'],
  i: number,
  theme: Theme,
): string {
  const explicit = data.series[i]?.color;
  if (explicit) return resolveColor(explicit, theme);
  return resolveColor(
    { kind: 'role', role: ACCENT_ROLES[i % ACCENT_ROLES.length] },
    theme,
  );
}

/** Round a value-axis max up to a "nice" 1/2/5×10ⁿ step. */
export function niceTicks(max: number, count = 5): { max: number; step: number } {
  if (!(max > 0)) return { max: 1, step: 1 };
  const rough = max / count;
  const mag = Math.pow(10, Math.floor(Math.log10(rough)));
  const norm = rough / mag;
  const nice = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10;
  const step = nice * mag;
  return { max: Math.ceil(max / step) * step, step };
}

const PAD = 8;

export function drawChart(
  ctx: CanvasRenderingContext2D,
  size: { w: number; h: number },
  data: ChartElement['data'],
  theme: Theme,
  opts?: { fontScale?: number },
): void {
  void opts;
  const axisColor = resolveColor({ kind: 'role', role: 'textSecondary' }, theme);
  const gridColor = resolveColor({ kind: 'role', role: 'backgroundAlt' }, theme);

  // Plot rectangle (leave room for value labels on the left, categories below).
  const left = 36;
  const bottom = 20;
  const plot = {
    x: left,
    y: PAD,
    w: Math.max(0, size.w - left - PAD),
    h: Math.max(0, size.h - PAD - bottom),
  };
  if (plot.w <= 0 || plot.h <= 0 || data.series.length === 0) return;

  if (data.kind === 'column' || data.kind === 'bar') {
    drawBars(ctx, plot, data, theme, { axisColor, gridColor });
    return;
  }
  // line/area/pie added in Task 6.
}

function seriesMax(data: ChartElement['data']): number {
  const stacked =
    data.grouping === 'stacked' || data.grouping === 'percentStacked';
  const n = data.categories.length || Math.max(...data.series.map((s) => s.values.length), 0);
  let max = 0;
  for (let c = 0; c < n; c++) {
    if (stacked) {
      let sum = 0;
      for (const s of data.series) sum += Math.max(0, s.values[c] ?? 0);
      max = Math.max(max, sum);
    } else {
      for (const s of data.series) max = Math.max(max, s.values[c] ?? 0);
    }
  }
  return max;
}

function drawBars(
  ctx: CanvasRenderingContext2D,
  plot: { x: number; y: number; w: number; h: number },
  data: ChartElement['data'],
  theme: Theme,
  colors: { axisColor: string; gridColor: string },
): void {
  const isPercent = data.grouping === 'percentStacked';
  const isStacked = data.grouping === 'stacked' || isPercent;
  const cats = data.categories.length
    ? data.categories.length
    : Math.max(...data.series.map((s) => s.values.length), 1);
  const domainMax = isPercent ? 1 : niceTicks(seriesMax(data)).max || 1;

  // Axis line.
  ctx.strokeStyle = colors.axisColor;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(plot.x, plot.y);
  ctx.lineTo(plot.x, plot.y + plot.h);
  ctx.lineTo(plot.x + plot.w, plot.y + plot.h);
  ctx.stroke();

  const slot = plot.w / cats;
  const groupPad = slot * 0.15;
  const yOf = (v: number) => plot.y + plot.h - (v / domainMax) * plot.h;

  for (let c = 0; c < cats; c++) {
    const x0 = plot.x + c * slot + groupPad;
    const groupW = slot - groupPad * 2;
    if (isStacked) {
      let acc = 0;
      const total = isPercent
        ? data.series.reduce((sum, s) => sum + Math.max(0, s.values[c] ?? 0), 0) || 1
        : 1;
      for (let s = 0; s < data.series.length; s++) {
        const raw = Math.max(0, data.series[s].values[c] ?? 0);
        const v = isPercent ? raw / total : raw;
        const yTop = yOf(acc + v);
        const yBot = yOf(acc);
        ctx.fillStyle = seriesColorAt(data, s, theme);
        ctx.fillRect(x0, yTop, groupW, yBot - yTop);
        acc += v;
      }
    } else {
      const barW = groupW / data.series.length;
      for (let s = 0; s < data.series.length; s++) {
        const v = Math.max(0, data.series[s].values[c] ?? 0);
        const yTop = yOf(v);
        ctx.fillStyle = seriesColorAt(data, s, theme);
        ctx.fillRect(x0 + s * barW, yTop, barW, plot.y + plot.h - yTop);
      }
    }
  }
  void colors.gridColor; // gridlines refined in Task 6
}
```

(For `kind === 'bar'` — horizontal — Phase 1 may paint it with the same vertical routine as a known limitation, or swap the axis mapping. Keep the test asserting bar *count*, not orientation, so this task passes; note orientation as a follow-up in the lessons file.)

- [ ] **Step 4: Wire the renderer switch**

In `packages/slides/src/view/canvas/element-renderer.ts`, import `drawChart` and add a `case 'chart'` in the `switch (element.type)` at `:260`, mirroring the `table` case (paint under `withCounterFlip`, honor `shadow`):

```ts
        case 'chart':
          if (shadow) applyShadow(ctx, shadow, theme);
          withCounterFlip(ctx, size, totalFlip, () => {
            drawChart(ctx, size, element.data, theme, { fontScale });
          });
          break;
```

- [ ] **Step 5: Run tests to verify pass**

Run: `pnpm --filter @wafflebase/slides test -- chart-renderer`
Expected: PASS (niceTicks 2 + column 2).
Then: `pnpm --filter @wafflebase/slides build` — the `element.type` switch is now exhaustive again.

- [ ] **Step 6: Commit**

```bash
git add packages/slides/src/view/canvas/chart-renderer.ts packages/slides/src/view/canvas/element-renderer.ts packages/slides/test/view/canvas/chart-renderer.test.ts
git commit -m "Paint column/bar charts on the slides canvas"
```

---

### Task 6: Painter — line, area, pie + legend/title/gridlines

**Files:**
- Modify: `packages/slides/src/view/canvas/chart-renderer.ts`
- Test: `packages/slides/test/view/canvas/chart-renderer.test.ts` (append)

**Interfaces:**
- Consumes: Task 5 exports.
- Produces: `drawChart` now paints `line`, `area`, `pie`, draws value-axis gridlines when `data.showGridlines`, a legend when `data.legend && data.legend !== 'none'`, and a title when `data.title`. No signature change.

- [ ] **Step 1: Write the failing tests (append)**

```ts
describe('drawChart — line/area/pie', () => {
  const line = (kind: 'line' | 'area'): ChartElement['data'] => ({
    kind, categories: ['a', 'b', 'c'],
    series: [{ name: 'S', values: [1, 3, 2] }],
  });

  it('strokes a polyline for a line chart', () => {
    const ctx = createCtxSpy();
    drawChart(asCtx(ctx), size, line('line'), THEME);
    expect(ctx.stroke).toHaveBeenCalled();
    expect(ctx.lineTo).toHaveBeenCalled();
  });

  it('fills an area chart', () => {
    const ctx = createCtxSpy();
    drawChart(asCtx(ctx), size, line('area'), THEME);
    expect(ctx.fill).toHaveBeenCalled();
  });

  it('draws pie slices with arc()', () => {
    const ctx = createCtxSpy();
    drawChart(asCtx(ctx), size, {
      kind: 'pie', categories: ['A', 'B'], series: [{ values: [60, 40] }],
    }, THEME);
    expect(ctx.arc).toHaveBeenCalledTimes(2);
  });

  it('draws gridlines when showGridlines is set', () => {
    const plain = createCtxSpy();
    drawChart(asCtx(plain), size, columnData(), THEME);
    const grid = createCtxSpy();
    drawChart(asCtx(grid), size, { ...columnData(), showGridlines: true }, THEME);
    expect(grid.stroke.mock.calls.length).toBeGreaterThan(plain.stroke.mock.calls.length);
  });
});
```

(Confirm `ctx-spy` records `arc`, `lineTo`, `fill`, `stroke`. If a method is missing from the spy, add it there or assert on a recorded method that exists.)

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @wafflebase/slides test -- chart-renderer`
Expected: FAIL — line/area/pie draw nothing; no gridlines.

- [ ] **Step 3: Extend `drawChart`**

In `drawChart`, after the bar branch, add line/area (`drawLines`) and pie (`drawPie`) branches; add a gridline pass in `drawBars`/`drawLines`; add `drawLegend` + `drawTitle` calls at the end. Provide the implementations:

```ts
function drawGridlines(ctx, plot, domainMax, color) {
  const { step } = niceTicks(domainMax);
  ctx.strokeStyle = color; ctx.lineWidth = 1;
  for (let v = step; v <= domainMax + 1e-9; v += step) {
    const y = plot.y + plot.h - (v / domainMax) * plot.h;
    ctx.beginPath(); ctx.moveTo(plot.x, y); ctx.lineTo(plot.x + plot.w, y); ctx.stroke();
  }
}

function drawLines(ctx, plot, data, theme, colors) {
  const cats = data.categories.length || Math.max(...data.series.map(s => s.values.length), 1);
  const domainMax = niceTicks(seriesMax({ ...data, grouping: undefined })).max || 1;
  if (data.showGridlines) drawGridlines(ctx, plot, domainMax, colors.gridColor);
  // axis
  ctx.strokeStyle = colors.axisColor; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(plot.x, plot.y); ctx.lineTo(plot.x, plot.y + plot.h);
  ctx.lineTo(plot.x + plot.w, plot.y + plot.h); ctx.stroke();
  const xOf = (c) => plot.x + (cats <= 1 ? plot.w / 2 : (c / (cats - 1)) * plot.w);
  const yOf = (v) => plot.y + plot.h - (v / domainMax) * plot.h;
  for (let s = 0; s < data.series.length; s++) {
    const col = seriesColorAt(data, s, theme);
    const vals = data.series[s].values;
    ctx.beginPath();
    for (let c = 0; c < cats; c++) {
      const x = xOf(c), y = yOf(Math.max(0, vals[c] ?? 0));
      if (c === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    if (data.kind === 'area') {
      ctx.lineTo(xOf(cats - 1), plot.y + plot.h);
      ctx.lineTo(xOf(0), plot.y + plot.h);
      ctx.closePath();
      ctx.fillStyle = col; ctx.globalAlpha = 0.35; ctx.fill(); ctx.globalAlpha = 1;
      ctx.beginPath();
      for (let c = 0; c < cats; c++) {
        const x = xOf(c), y = yOf(Math.max(0, vals[c] ?? 0));
        if (c === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
    }
    ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.stroke();
  }
}

function drawPie(ctx, plot, data, theme) {
  const vals = (data.series[0]?.values ?? []).map((v) => Math.max(0, v ?? 0));
  const total = vals.reduce((a, b) => a + b, 0) || 1;
  const cx = plot.x + plot.w / 2, cy = plot.y + plot.h / 2;
  const r = Math.min(plot.w, plot.h) / 2;
  let a0 = -Math.PI / 2;
  for (let i = 0; i < vals.length; i++) {
    const a1 = a0 + (vals[i] / total) * Math.PI * 2;
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, r, a0, a1); ctx.closePath();
    ctx.fillStyle = seriesColorAt(data, i, theme); ctx.fill();
    a0 = a1;
  }
}

function drawTitle(ctx, size, title, theme, fontScale) {
  ctx.fillStyle = resolveColor({ kind: 'role', role: 'text' }, theme);
  ctx.font = `${14 * (fontScale ?? 1)}px sans-serif`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  ctx.fillText(title, size.w / 2, 2);
}

function drawLegend(ctx, size, data, theme) {
  const items = data.series.map((s, i) => ({ label: s.name ?? `Series ${i + 1}`, i }));
  ctx.font = '11px sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  let x = 40; const y = size.h - 8;
  for (const it of items) {
    ctx.fillStyle = seriesColorAt(data, it.i, theme);
    ctx.fillRect(x, y - 5, 10, 10);
    ctx.fillStyle = resolveColor({ kind: 'role', role: 'text' }, theme);
    ctx.fillText(it.label, x + 14, y);
    x += 14 + ctx.measureText(it.label).width + 16;
  }
}
```

Then route in `drawChart`: reserve top margin when `data.title`, bottom margin when `data.legend && data.legend !== 'none'` (and default legend to shown when `series.length > 1`); call `drawBars`/`drawLines`/`drawPie` by `kind`; call `drawTitle`/`drawLegend` last. Keep the pie branch skipping axis/gridlines. Add `showGridlines` handling to `drawBars` via `drawGridlines`. Type the helper params (`plot: {x;y;w;h}`, etc.) to satisfy the build — the snippets omit annotations for brevity.

- [ ] **Step 4: Run tests to verify pass**

Run: `pnpm --filter @wafflebase/slides test -- chart-renderer`
Expected: PASS (all column + line/area/pie + gridlines cases).

- [ ] **Step 5: Commit**

```bash
git add packages/slides/src/view/canvas/chart-renderer.ts packages/slides/test/view/canvas/chart-renderer.test.ts
git commit -m "Paint line, area, pie charts + legend, title, gridlines"
```

---

### Task 7: PDF font scan, export smoke test, hit-test verification

**Files:**
- Modify: `packages/slides/src/export/pdf.ts` (`collectTextBodies` scan at `:222`)
- Test: `packages/slides/test/export/pdf-chart.test.ts`
- Test: `packages/slides/test/view/canvas/chart-hit-test.test.ts`
- Modify (only if hit-test verification fails): `packages/slides/src/view/editor/hit-test-elements.ts`

**Interfaces:**
- Consumes: `drawChart` (Task 5/6), the PDF export entry (inspect `pdf.ts` for its exported function name, e.g. `exportSlidesPdf` / `slidesToPdf`), the hit-test entry in `hit-test-elements.ts` (inspect for its exported function, e.g. `hitTestElements` / `elementAt`).
- Produces: PDF export includes chart title/legend/label glyphs in font embedding; a chart element is hit-testable by its frame bbox.

- [ ] **Step 1: Write the hit-test test**

Create `packages/slides/test/view/canvas/chart-hit-test.test.ts`. First read `src/view/editor/hit-test-elements.ts` to learn the exact exported function name and signature, then assert a point inside a chart's frame resolves to that chart:

```ts
import { describe, it, expect } from 'vitest';
// import { <hitTestFn> } from '../../../src/view/editor/hit-test-elements';
import type { ChartElement } from '../../../src/model/element';

const chart: ChartElement = {
  id: 'c1', type: 'chart',
  frame: { x: 100, y: 100, w: 200, h: 150, rotation: 0 },
  data: { kind: 'column', categories: ['a'], series: [{ values: [1] }] },
};

describe('hit-test — chart', () => {
  it('resolves a point inside the chart frame to the chart', () => {
    // const hit = <hitTestFn>([chart], { x: 150, y: 150 }, ...);
    // expect(hit?.id).toBe('c1');
    expect(chart.type).toBe('chart'); // replace with real assertion
  });
});
```

- [ ] **Step 2: Run it**

Run: `pnpm --filter @wafflebase/slides test -- chart-hit-test`
Expected: PASS if the default bbox path already handles charts (most likely — charts are plain framed elements). If FAIL, add a `chart` branch alongside the existing default in `hit-test-elements.ts` so a chart is treated like a rectangular element, then re-run to PASS. Do not special-case beyond bbox.

- [ ] **Step 3: Write the PDF export smoke test**

Create `packages/slides/test/export/pdf-chart.test.ts`. Read `pdf.ts` for the export entry and any existing PDF test (`packages/slides/test/export/*.test.ts`) to copy its document-fixture + invocation shape. Assert a one-slide deck containing a `ChartElement` exports to a non-empty PDF byte array without throwing:

```ts
import { describe, it, expect } from 'vitest';
// import { <exportFn> } from '../../src/export/pdf';
// build a minimal SlidesDocument with a single chart element (reuse the
// helper other pdf tests use), then:
it('exports a deck with a chart without throwing', async () => {
  // const bytes = await <exportFn>(doc, ...);
  // expect(bytes.byteLength).toBeGreaterThan(0);
  expect(true).toBe(true); // replace with real assertion
});
```

- [ ] **Step 4: Run it to see current behavior**

Run: `pnpm --filter @wafflebase/slides test -- pdf-chart`
Expected: PASS if `drawSlide` already paints the chart into the PDF canvas (it should, via Task 5's switch case). Font embedding for chart-only text is the gap Step 5 closes.

- [ ] **Step 5: Include chart text in the font-embedding scan**

In `packages/slides/src/export/pdf.ts`, find `collectTextBodies` (`:222`). It walks elements for `TextBody`s to embed fonts. Charts carry label/title/legend text that `drawChart` renders with `sans-serif`; ensure the export's font set includes the generic sans fallback used by `drawChart` so glyphs embed. Concretely: if `collectTextBodies` drives which fonts load, add the chart title string (and series names) as plain-text contributors, OR confirm the export already embeds the base sans font unconditionally. Read the function and make the minimal change; if the base font is always embedded, no code change is needed — record that in the lessons file and keep the smoke test as the guard.

- [ ] **Step 6: Run the full slides suite**

Run: `pnpm --filter @wafflebase/slides test`
Expected: PASS (all suites).

- [ ] **Step 7: Commit**

```bash
git add packages/slides/src/export/pdf.ts packages/slides/test/export/pdf-chart.test.ts packages/slides/test/view/canvas/chart-hit-test.test.ts
git commit -m "Verify chart hit-test + PDF export; embed chart text fonts"
```

---

### Task 8: End-to-end import integration + verification

**Files:**
- Test: `packages/slides/test/import/pptx/chart-integration.test.ts`
- Modify: `docs/tasks/active/20260709-slides-charts-todo.md` (check off + Review section)

**Interfaces:**
- Consumes: the full import entry (`importPptx` / `parsePptx` in `src/import/pptx/index.ts` — inspect for the exact export) plus a real fixture PPTX.

- [ ] **Step 1: Add a fixture deck**

Obtain the source PPTX behind the shared link (ask the user) OR author a minimal 2-slide `.pptx` (slide 2 = a clustered column chart) and place it under the existing pptx fixture dir (find it: `find packages/slides/test -iname '*.pptx'`). If authoring, build a `.pptx` zip with `ppt/slides/slide2.xml` (graphicFrame → chart rId), `ppt/slides/_rels/slide2.xml.rels`, and `ppt/charts/chart1.xml` (barChart with num/str caches).

- [ ] **Step 2: Write the integration test**

```ts
// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
// import { <importFn> } from '../../../src/import/pptx';

it('imports slide 2 chart as a ChartElement, not dropped', async () => {
  const buf = readFileSync(new URL('./fixtures/chart-deck.pptx', import.meta.url));
  // const { document, report } = await <importFn>(new Uint8Array(buf), ...);
  // const slide2 = document.slides[1];
  // const chart = slide2.elements.find((e) => e.type === 'chart');
  // expect(chart).toBeDefined();
  // expect(report.importedCharts).toBe(1);
  expect(buf.byteLength).toBeGreaterThan(0); // replace with real assertions
});
```

- [ ] **Step 3: Run it**

Run: `pnpm --filter @wafflebase/slides test -- chart-integration`
Expected: PASS — slide 2 contains a `chart` element and `report.importedCharts === 1`.

- [ ] **Step 4: Run the pre-commit gate**

Run: `pnpm verify:fast`
Expected: lint + unit tests green across the workspace.

- [ ] **Step 5: Manual smoke (UI changed)**

Run `pnpm dev`, import the fixture/source deck, confirm slide 2 shows a chart resembling the PowerPoint original (bars, colors, legend, title) and that PDF export renders it. Capture before/after in the task's Review section.

- [ ] **Step 6: Fill in task docs + commit**

Update `docs/tasks/active/20260709-slides-charts-todo.md` (check boxes, Review section with behavior diff vs `main` and screenshots) and add lessons to `20260709-slides-charts-lessons.md`.

```bash
git add packages/slides/test/import/pptx/chart-integration.test.ts packages/slides/test/import/pptx/fixtures docs/tasks/active/20260709-slides-charts-*.md
git commit -m "Add end-to-end chart import integration test"
```

- [ ] **Step 7: Self review + PR**

Run `/code-review` over the full branch diff; apply blocking findings. Then `git fetch && git rebase origin/main`, push `slides-charts`, open a PR (title ≤70 chars; body = Summary + Test plan).

---

## Self-Review Notes

- **Spec coverage:** ChartElement model (T1) ✔; PPTX parse of column/bar/line/area/pie + grouping/legend/title/gridlines/colors (T2–T3) ✔; dispatch fix + placeholder + report counters (T4) ✔; Canvas painter with PDF-for-free (T5–T6, verified T7) ✔; hit-test (T7) ✔; unsupported → reported placeholder (T4) ✔; non-goals (editing, PPTX export, CRDT) untouched ✔.
- **Verify-before-assumption points flagged inline:** `xml.ts:child(undefined)` tolerance (T2); `getAttribute('r:id')` under jsdom (T4); `readAltText` import path + `SlideElement` alias (T4); `ctx-spy` recorded methods `fillRect`/`arc`/`lineTo`/`fill`/`stroke` (T5–T6); PDF/hit-test exported fn names (T7); import entry name + fixture dir (T8). Each is caught by that task's test if wrong.
- **Type consistency:** `ChartElement['data']` shape is identical across T2 (`parseChartXml` return), T4 (`parseChartFrame`), T5–T6 (`drawChart` param). Color type is `ThemeColor` throughout (not `StoredColor`). `seriesColorAt`/`niceTicks`/`ACCENT_ROLES` names are stable T5→T6.
- **Known limitations to note in lessons:** `bar` (horizontal) may paint like `column` in Phase 1; `schemeClr` series colors fall back to the accent cycle; data labels / secondary axes / number formats ignored.
