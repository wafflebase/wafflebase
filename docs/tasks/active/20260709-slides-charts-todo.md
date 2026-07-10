# Slides Charts — Phase 1 (import + render + PDF)

Design: [docs/design/slides/slides-charts.md](../../design/slides/slides-charts.md)
Plan: [20260709-slides-charts-plan.md](./20260709-slides-charts-plan.md) — task-by-task TDD steps

Root cause: every `<p:graphicFrame>` routes to `parseTable`
(`packages/slides/src/import/pptx/shape.ts:383`), which returns `[]` for
non-table frames (`import/pptx/table.ts:46`). Chart graphicFrames produce
zero elements silently and are not even counted in `ImportReport`. Slides
model has no chart element type.

## Scope

- Native `ChartElement` (`type: 'chart'`), self-contained spec from PPTX
  `numCache`/`strCache`.
- Core 5 families: column, bar, line, area, pie + clustered/stacked/100%.
- Canvas-native painter → editor, thumbnail, PDF export all consistent.
- Unsupported chart types → reported grey placeholder, never dropped.
- No in-app chart editing, no PPTX export round-trip (Phase 2).

## Tasks

- [~] Obtain the source PPTX (the deck behind the shared link) as an
      import fixture — not provided; authored a synthetic 2-slide fixture
      (Task 8) with a clustered column chart on slide 2.
- [x] Model: `ChartElement` + `ChartSeries`/`ChartKind`/`ChartGrouping`/
      `ChartLegendPos` in `model/element.ts` union + `ElementInit`
      (commit 36863023f). `clone.ts` is generic JSON clone; `migrate.ts`
      needs no change.
- [x] Import: `graphicFrame` dispatch by `graphicData/@uri`
      (`import/pptx/shape.ts`); `import/pptx/chart.ts`
      `parseChartXml`/`parseChartFrame` mapping `ppt/charts/chartN.xml` →
      `ChartElement` (commits 4bbdb0b1a, 6e94f64ea, 0a018b70f).
- [x] Import: grey placeholder + `importedCharts`/`unsupportedCharts`
      counters + summary lines in `import/pptx/report.ts` (0a018b70f).
- [x] Render: `view/canvas/chart-renderer.ts` + `case 'chart'` in
      `element-renderer.ts`; nice-number axis ticks, grouping-aware
      column/bar, line/area fill, pie sweeps, square legend swatches,
      title, gridlines, theme accent colors (commits 4b3465ebf,
      a0cc44d1c, 72b0ae0c5).
- [x] PDF: verified chart slide exports. NOTE: slides PDF is a **raster**
      pipeline (`exportSlidesPdf` → `drawSlide` → PNG → pdf-lib), so
      canvas charts are captured automatically — no `collectTextBodies`
      font-embedding step exists (that was a docs-export assumption; the
      real fn is `collectFontFamilies` and it doesn't touch charts).
      Smoke test in `test/export/pdf-chart.test.ts` (commit 8075e61e6).
- [x] Hit-test: `hitTestElement` default bbox path already selects charts
      (no source change); `test/view/canvas/chart-hit-test.test.ts`,
      incl. rotated-group nesting (8075e61e6). No double-click text entry.
- [x] Tests (TDD): failing end-to-end import test reproducing the drop →
      pass (`test/import/pptx/chart-integration.test.ts`, drives real
      `importPptx` dispatcher, 3e9b00e30); per-kind/grouping painter tests
      (`chart-renderer.test.ts`); PDF no-crash; unsupported-type
      placeholder + counter (`chart-frame.test.ts`).
- [x] `pnpm verify:fast` green (slides 2539 tests). Self-review: per-task
      spec+quality reviews on every commit; final whole-branch review.

## Review

**Outcome:** Charts on imported PPTX decks are no longer silently dropped.
A `<p:graphicFrame>` carrying a `<c:chart>` now imports as a native
`ChartElement` (column/bar/line/area/pie + clustered/stacked/100%), reads
the frozen `numCache`/`strCache` values and series colors, paints on the
Canvas (so editor, thumbnail, and raster PDF export all match), and is
selectable/movable. Unsupported chart families import as a reported grey
placeholder and bump `unsupportedCharts` instead of vanishing.

**Behavior diff vs main:** on `main`, every `graphicFrame` → `parseTable`
→ `[]` for charts (silent, uncounted). On this branch, chart frames route
to `parseChartFrame`; `ImportReport` gains `importedCharts` /
`unsupportedCharts` surfaced in the summary. New `ChartElement` model
type, `chart-renderer.ts` painter, and `case 'chart'` render dispatch.

**Executed via** subagent-driven development — 8 tasks, per-task
spec+quality review, one fix loop (Task 6 legend swatch), final
whole-branch review. See `*-lessons.md`.

**Hardening (from high-effort `/code-review`, commit 0c31183c0):** a
malformed chart part no longer aborts the whole import (try/catch →
placeholder); an adversarial `<c:pt idx>` can no longer allocate a giant
array (DoS guard); `chartex`/diagram/SmartArt/OLE graphic-frames now
import as a reported grey placeholder instead of silently vanishing
uncounted; `r:id` uses the namespaced fallback; legend `tr` maps to
right; literal `<c:tx><c:v>` series names are read.

**Known Phase-1 limitations (follow-ups):**
- **Negative values render blank** — `seriesMax`/painters clamp to 0; a
  profit/loss chart needs a signed zero-baseline axis. (CR finding [4].)
- **Stacked/percentStacked line & area** not accumulated — series overlap.
- **Horizontal `bar`** paints with the vertical column routine.
- **Legend position** (top/left/right) not honored — always a bottom band.
- **`schemeClr` series colors** fall back to the theme accent cycle.
- **PPTX export** silently omits charts (returns `''`) — export round-trip
  is Phase 2; no report signal yet. (CR finding [2].)
- **`unsupportedCharts` summary copy** says "chart(s) unsupported" even for
  SmartArt/chartex frames — loose wording, consider renaming the counter.
- **`readCache` implicit-index base** uses point count, not max-seen-idx —
  differs only for the (Office-never-emitted) idx-less-after-explicit case.
- No in-app chart creation/editing.

**PR:** (add link after opening)
