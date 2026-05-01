# PDF export parity — Lessons

## Table content parity

- Canvas table rendering filters swept-back rows during paginated merged-cell
  rendering: non-merged cells from earlier rows are not re-painted on the later
  page.
- Canvas also filters merged-cell lines and list markers by the row range that
  belongs to the current page fragment. PDF previously computed merged-cell
  line positions but did not apply the same owner-row filter.
- Imported DOCX documents can use nested tables for ordinary-looking form
  layouts. Canvas recurses into `line.nestedTable`, while PDF was explicitly
  skipping those lines, so nested table content could disappear entirely.
- PDF originally skipped every consecutive `PageLine` with the same table
  block after one paint pass. That is only valid for plain row ranges. Split
  row fragments need the same `shouldStartTableRender` predicate as Canvas so
  each clipped fragment gets painted.
