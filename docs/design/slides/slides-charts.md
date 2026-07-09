---
title: slides-charts
target-version: 0.5.0
---

<!-- Make sure to append document link in design README.md after creating the document. -->

# Slides Charts

## Summary

Add a native `ChartElement` to `@wafflebase/slides` so charts survive PPTX
import and render on the Canvas with PowerPoint-like fidelity.

Today every `<p:graphicFrame>` in a slide is routed unconditionally to the
table parser (`packages/slides/src/import/pptx/shape.ts:383` →
`parseTable`), which returns an empty list when the frame is not a
`<a:tbl>` (`packages/slides/src/import/pptx/table.ts:46`). A chart's
`graphicFrame` therefore produces **zero elements, silently** — it is not
placeholdered, not rasterized, and not even counted in `ImportReport`.
That is why the second slide of an imported deck loses its chart with no
warning.

PPTX stores the numbers PowerPoint last computed inside the chart part's
`<c:numCache>` / `<c:strCache>`. Reading those caches lets us reproduce
"exactly what PowerPoint showed" without evaluating any source formulas.
A native, Canvas-painted chart element then gives us PDF export for free
(`export/pdf.ts` reuses `drawSlide()`), identical editor/thumbnail
rendering, and a future path to editing and PPTX round-trip.

### Goals

- New `ChartElement` (`type: 'chart'`) in the slides model — a
  self-contained chart spec (kind, grouping, categories, series values
  and colors, legend, title). Self-contained because a slide has no
  source spreadsheet; the values come from the PPTX cache.
- PPTX import parses `ppt/charts/chartN.xml` for the core chart families
  (`barChart` in both column and bar directions, `lineChart`,
  `areaChart`, `pieChart`) including `clustered` / `stacked` /
  `percentStacked` grouping, and produces a `ChartElement`.
- Canvas-native painter draws the chart in element-local coordinates, so
  editor, thumbnail, and PDF export are all identical and no external
  rendering service is needed.
- Charts that Phase 1 does not yet support (doughnut, scatter, bubble,
  radar, combo, stock, surface, …) import as a labeled grey placeholder
  box, **never silently dropped**, and are counted in `ImportReport`.
- Charts move / resize / delete like any other framed element via the
  existing bbox selection path.

### Non-Goals

- **Creating or editing charts inside Wafflebase.** Phase 1 is
  import + render + PDF only. Changing chart type, data, series colors,
  legend, or adding a new chart from scratch is Phase 2. Double-click
  does not enter any editor.
- **Chart families beyond the core five.** doughnut, scatter, bubble,
  radar, combo, stock, surface, and 3-D variants render as placeholders
  in Phase 1.
- **PPTX export round-trip.** Phase 1 does not emit `<c:chart>`. When
  PPTX export runs (`docs/design/slides/slides-pptx-export.md`), a
  `ChartElement` falls back to a rasterized picture or is skipped with a
  report entry; true `<p:graphicFrame>`/`<c:chart>` round-trip is a
  Phase 2 item folded into that document.
- **Collaborative (CRDT) editing of chart data.** Charts are static
  imported payloads in Phase 1; they batch through the existing snapshot
  undo path like any element, but there is no per-series concurrent
  editing.
- **Reusing the sheets Recharts renderers.** Sheets charts render via
  React + Recharts (SVG) in `packages/frontend`; they cannot paint into
  the slides Canvas 2D path. We reuse the *concept* (chart type union,
  dataset shape) and write a Canvas painter.

## Proposal Details

### Data model

`ChartElement` joins the `Element` union in
`packages/slides/src/model/element.ts:560` (and `ElementInit` at `:571`),
with matching handling in `model/clone.ts` and `model/migrate.ts`.

```ts
type ChartKind = 'column' | 'bar' | 'line' | 'area' | 'pie';
type ChartGrouping = 'clustered' | 'stacked' | 'percentStacked' | 'standard';

interface ChartSeries {
  name?: string;              // c:ser/c:tx strCache
  values: (number | null)[];  // c:ser/c:val numCache (null = blank point)
  color?: StoredColor;        // c:ser/c:spPr solidFill; else theme accent cycle
}

interface ChartElement {
  id: string;
  type: 'chart';
  frame: Frame;               // slide coords x/y/w/h, from graphicFrame xfrm
  data: {
    kind: ChartKind;
    grouping?: ChartGrouping; // bar/area only; ignored for line/pie
    title?: string;           // c:chart/c:title
    categories: string[];     // shared x-axis labels, c:cat strCache
    series: ChartSeries[];
    legend?: 'top' | 'bottom' | 'left' | 'right' | 'none'; // c:legend/c:legendPos
    showGridlines?: boolean;  // presence of c:majorGridlines on value axis
    alt?: string;             // <p:cNvPr descr>, same path as other elements
    effects?: Effects;        // shadow/reflection, reuse existing shape bag
  };
}
```

Values are stored on the element rather than referencing a sheet range,
because slides have no backing workbook. `numCache`/`strCache` gives us a
frozen snapshot that matches PowerPoint's last render.

### PPTX import

Fix the dispatch in `packages/slides/src/import/pptx/shape.ts:383`. A
`<p:graphicFrame>` is disambiguated by its
`<a:graphicData graphicData/@uri>`:

- `.../drawingml/2006/table` → existing `parseTable`.
- `.../drawingml/2006/chart` → new `parseChart`: resolve the frame's
  `<c:chart r:id>` through the slide rels to `ppt/charts/chartN.xml`,
  load that part, and map it.
- anything else (diagram/SmartArt, OLE) → grey placeholder + report
  counter (previously an unreported empty return).

New `packages/slides/src/import/pptx/chart.ts` maps `chartN.xml`:

- Walk `c:chartSpace/c:chart/c:plotArea` and pick the first plot type
  element: `c:barChart` (with `c:barDir val="col"|"bar"` →
  `column`/`bar`), `c:lineChart`, `c:areaChart`, `c:pieChart`.
- `grouping` from `c:grouping@val` (`clustered`/`stacked`/
  `percentStacked`/`standard`).
- For each `c:ser`: `name` from `c:tx` string cache, `values` from
  `c:val/c:numRef/c:numCache/c:pt`, `color` from `c:spPr` solidFill
  (resolve via the existing `clrMap`/theme path; fall back to the theme
  accent cycle by series index).
- `categories` from the first series' `c:cat` string (or number) cache.
- `title` from `c:chart/c:title` text runs; `legend` from `c:legend/
  c:legendPos`; `showGridlines` from `c:valAx/c:majorGridlines`.
- Any other plot element (`c:doughnutChart`, `c:scatterChart`,
  `c:bubbleChart`, `c:radarChart`, `c:stockChart`, `c:surfaceChart`,
  3-D variants) → return a placeholder marker so the dispatcher inserts
  the grey box.

`packages/slides/src/import/pptx/report.ts` gains `importedCharts` and
`unsupportedCharts` counters, surfaced in the import summary toast so
charts never disappear without a trace.

### Canvas painter

New `packages/slides/src/view/canvas/chart-renderer.ts`, dispatched from
the `switch (element.type)` in
`packages/slides/src/view/canvas/element-renderer.ts:260` via
`case 'chart'`. It paints in element-local coordinates
(`frame.w` × `frame.h`) with the 2D API:

- **Axes / gridlines** — a nice-number tick algorithm for the value axis;
  category axis labels along the bottom (column/line/area) or left (bar).
- **column / bar** — grouping-aware layout: `clustered` places series bars
  side by side per category; `stacked` accumulates; `percentStacked`
  normalizes each category to 100%.
- **line / area** — one polyline per series across categories; `area`
  fills to baseline (stacked when grouping says so).
- **pie** — cumulative sweep angles from the first series; slice labels.
- **legend / title** — reuse the font-measurement helpers from
  `text-renderer.ts`.
- **colors** — `StoredColor` resolved through the existing theme/fill
  resolve path, so charts recolor with the deck theme.

Because the editor and `view/canvas/thumbnail.ts` both go through
`drawSlide` → `drawElement`, on-screen and thumbnail rendering are
automatically consistent.

### PDF export

`packages/slides/src/export/pdf.ts` renders every slide through
`drawSlide()` (`pdf.ts:39,160`), so the Canvas painter reaches PDF with no
extra work. The one addition: include chart title / legend / label text in
the `collectTextBodies` font-embedding scan (`pdf.ts:222`) so chart glyphs
embed correctly.

### Editor edges

- **Hit-test** (`packages/slides/src/view/editor/hit-test-elements.ts`) —
  a chart is a rectangular frame, so the default bbox path handles
  select / move / resize; no special case like `group` is needed
  (verify, don't assume).
- **No text entry** — double-click and F2 do not enter chart editing in
  Phase 1.
- **Undo** — chart add/move/resize/delete batch through the existing
  `store.batch` snapshot path exactly like other elements.

### Testing

- **Import unit tests** — a real PPTX fixture containing the missing
  slide-2 chart. Assert `parseChart` yields a `ChartElement` with the
  expected `kind`, `grouping`, `categories`, per-series `values`, and
  colors. Write the failing test first (reproduce the drop), then make
  it pass.
- **Painter visual snapshots** — each `kind` × `grouping` combination
  drawn to an offscreen Canvas under `packages/*/harness/visual`, for
  regression.
- **PDF** — a chart slide exports without crashing and embeds chart text.
- **Fallback** — an unsupported chart type imports as a placeholder and
  increments `unsupportedCharts`.

### Risks and Mitigation

- **Painter fidelity vs PowerPoint.** Our Canvas painter will not be
  pixel-identical to PowerPoint's renderer. Mitigation: read the real
  cached values, series colors, legend, and title from the chart XML so
  data and palette match; tune axis/tick/legend layout against the fixture
  deck. Perfect parity is a non-goal; "clearly the same chart" is the bar.
- **Chart XML variety.** Real decks carry combo charts, secondary axes,
  data labels, number formats, and multi-level categories that Phase 1
  ignores. Mitigation: parse defensively, degrade to placeholder on any
  plot family we do not support, and always count it in the report so
  nothing vanishes silently.
- **Theme color resolution.** Series `<c:spPr>` may use theme references
  (`schemeClr`) rather than explicit RGB. Mitigation: resolve through the
  same `clrMap`/theme path the shape importer already uses; fall back to a
  deterministic accent cycle by series index when absent.
- **Model migration.** Adding a seventh element type must not break decks
  saved before charts existed. Mitigation: `migrate.ts` leaves existing
  documents untouched (charts only appear via new imports), and
  `clone.ts` handles the new type so copy/paste and duplication work.
- **PPTX export gap.** Until Phase 2, exporting a deck with charts loses
  chart-ness. Mitigation: raster fallback + a report entry on export so
  the user is told, and the round-trip work is tracked in
  `slides-pptx-export.md`.
