# Charts Phase 1 — Lessons Learned

## Decisions Made

- **Registry pattern** chosen over switch/case or config-object factory.
  Reason: independent renderer modules, editor driven by metadata.
- **Recharts kept** over Chart.js or ECharts. Already integrated, lazy-loaded,
  supports all Phase 1 chart types.
- **SheetChart model reused** for all types. Pie/scatter interpret
  xAxisColumn/seriesColumns differently rather than adding new fields.
  Avoids Yorkie schema migration.
- **bar/column kept as-is**: current "bar" renders vertical bars (Google
  Sheets' "Column"). Horizontal bar deferred to Phase 2.
- **Color palettes**: 3 presets (default/warm/cool). Default preserves
  existing theme-based behavior.

## Issues Encountered

- **Recharts animation non-determinism**: Line, Area, and Pie charts produce
  different SVG paths between renders due to JS-based animation (not CSS).
  Fix: `isAnimationActive={false}` on all shape components. Also benefits
  production — animations are unnecessary in a spreadsheet tool.
- **Scatter chart data mapping**: Recharts ScatterChart requires XAxis and
  YAxis to each have a `dataKey` for coordinate mapping. Unlike Bar/Line/Area
  where each series component has its own `dataKey`, Scatter needs per-series
  data transformation to `{x, y}` objects.
- **Scatter chart legend**: `ChartLegendContent` resolves labels by mapping
  the legend payload's `value` to a config key. Scatter's `name` prop must
  use `series.key` (not `series.label`) so the config lookup works.
- **Test infrastructure for chart-utils**: `chart-utils.ts` imports from
  `@wafflebase/sheet` which Node's test runner can't resolve. Fix: extracted
  `chart-colors.ts` without sheet dependency, and created custom resolve hooks
  (`register-hooks.mjs`, `resolve-hooks.mjs`).

## Open Questions

- Scatter chart with non-numeric X values: currently coerced at render time.
  May need validation in editor to warn user.
- Pie label rendering may overflow for many slices. Consider truncation or
  outer-label threshold.

## References

- Design doc: `design/charts.md`
- Google Sheets chart spec: provided by user in initial request
