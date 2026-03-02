# Lessons — Hide Formula Bar on Mobile

## What worked

- **Detached DOM pattern**: Creating the FormulaBar object but skipping
  `appendChild` on mobile keeps all method calls safe as no-ops on the
  detached element. No conditional guards needed at call sites.
- **Single option threading**: One `hideFormulaBar` boolean threaded through
  Options → Spreadsheet → Worksheet → GridContainer kept the change minimal
  (4 files, 14 lines added).

## Decisions

- Chose detached-DOM over CSS `display:none` to avoid layout recalc costs
  and to guarantee zero height contribution from the formula bar container.
