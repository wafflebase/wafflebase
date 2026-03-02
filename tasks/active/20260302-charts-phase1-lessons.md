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

## Open Questions

- Scatter chart with non-numeric X values: currently coerced at render time.
  May need validation in editor to warn user.
- Pie label rendering may overflow for many slices. Consider truncation or
  outer-label threshold.

## References

- Design doc: `design/charts.md`
- Google Sheets chart spec: provided by user in initial request
