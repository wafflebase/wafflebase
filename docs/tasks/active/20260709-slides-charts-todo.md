# Slides Charts — Phase 1 (import + render + PDF)

Design: [docs/design/slides/slides-charts.md](../../design/slides/slides-charts.md)

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

- [ ] Obtain the source PPTX (the deck behind the shared link) as an
      import fixture; confirm slide-2 chart's actual family is in scope.
- [ ] Model: add `ChartElement` + `ChartSeries`/`ChartKind`/`ChartGrouping`
      to `model/element.ts` union + `ElementInit`; handle in `clone.ts`,
      `migrate.ts`.
- [ ] Import: `graphicFrame` dispatch by `graphicData/@uri`
      (`import/pptx/shape.ts`); new `import/pptx/chart.ts` mapping
      `ppt/charts/chartN.xml` → `ChartElement`.
- [ ] Import: placeholder + `importedCharts`/`unsupportedCharts` counters
      in `import/pptx/report.ts`; surface in summary toast.
- [ ] Render: `view/canvas/chart-renderer.ts` + `case 'chart'` in
      `element-renderer.ts`; nice-number axis ticks, grouping-aware
      column/bar, line/area fill, pie sweeps, legend/title, theme colors.
- [ ] PDF: include chart text in `collectTextBodies` scan
      (`export/pdf.ts:222`); verify chart slide exports.
- [ ] Hit-test: verify default bbox select/move/resize works
      (`view/editor/hit-test-elements.ts`); no double-click text entry.
- [ ] Tests (TDD): failing import test reproducing the drop → pass;
      painter visual snapshots per kind × grouping; PDF no-crash;
      unsupported-type placeholder + counter.
- [ ] `pnpm verify:fast` green; self review via `/code-review` over the
      branch diff before PR.

## Review

(fill in after implementation — behavior diff vs main, PR link)
