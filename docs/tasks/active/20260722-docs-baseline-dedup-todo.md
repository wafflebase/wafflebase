# Docs — De-duplicate the line baseline formula across renderers

## Context

Follow-up to the mixed-size baseline fix (PR #507), which was scoped to the
screen text painter. The same alphabetic-baseline formula
`lineY + (lineHeight + fontSizePx * 0.8) / 2` was copy-pasted across six
sites in three files, keyed to each run's / marker's own font size — so table
cells, PDF export, and list markers still floated smaller runs above a taller
line. The duplication is what let the original bug exist and drift.

This PR extracts one shared helper and routes every renderer through it,
applying the line-common baseline everywhere.

## Work

- [x] Add `lineBaselineY(lineY, lineHeight, maxFontSizePx)` to `view/theme.ts`
  — single source of truth, returns an UNROUNDED value (canvas rounds, PDF
  must not).
- [x] Route all six sites through it, passing `line.maxFontSizePx` (with a
  `?? own size` fallback):
  - `paint-layout.ts` — `renderRun` (dedupe) + `renderListMarker` (new
    `lineMaxFontSizePx` param; marker font stays its own size, baseline uses
    line max).
  - `table-renderer.ts` — cell text run + list marker.
  - `pdf-painter.ts` — `paintRun` (new param, threaded from caller) + two
    marker sites; unrounded to preserve continuous PDF coords.
  - `doc-canvas.ts` — pass `pl.line.maxFontSizePx` to the marker call.
- [x] Tests: `theme.test.ts` (helper formula + unrounded contract),
  `render-list-marker.test.ts` (marker baseline uses line max, not marker
  size), existing table/PDF suites as regression guards.
- [x] docs typecheck + suite green (81 files); slides typecheck + tests green.

## Notes

- Data was already in place: `LayoutLine.maxFontSizePx` (added in #507)
  propagates to table/PDF because they render the same `LayoutLine` objects —
  no layout changes needed, painters only.
- Uniform-size content is unchanged: `maxFontSizePx ≈ own size` for a
  single-size line, and the fallback preserves behaviour for non-text lines.
