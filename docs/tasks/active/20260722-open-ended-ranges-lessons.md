# Lessons — open-ended range references (#280)

## Context

Add whole-column (`A:A`), whole-row (`1:1`), and open-ended (`A1:B`) range
support to the formula engine.

## Notes

- Ranges are stored as concrete `[from, to]` `Ref` pairs, so unbounded refs must
  be clamped to the sheet's data extent before they reach the evaluator. Chosen
  strategy: rewrite the formula's unbounded `REFERENCE` tokens to concrete
  bounded ranges once (calculator + dependants map), leaving the evaluator and
  every `toSrefs` call site untouched.

## Surprises / pitfalls

- (to fill in during implementation)

## Follow-ups / known limitations

- Cross-sheet unbounded refs (`Sheet2!A:A`) not resolved — calculator only has
  local bounds.
