# Impeccable frontend sweep — lessons

## Setup
- `:5173` was serving the `waffledocs` checkout; the critique ran against a
  second Vite on `:5181` from this tree.
- Parallel agents share one working tree, so each owns a disjoint set of
  files; shared primitives (`userFacingError`, `focus-ring`) were written
  first so nobody had to edit a common file mid-flight.

## Review rounds
- Round 1 (correctness/tests): 2 blocking. test-adequacy — the
  "column layout when a filter empties the body" test compared header
  classes with themselves; rewritten to compare header sizing tokens with the
  body cells', and mutation-checked (fails without the header `className`).
  blast-radius — marking Inter `eager` made `ensureFontLink` resolve at once,
  dropping the slides PDF export's stylesheet wait; eager families now await
  the bootstrap link (closing the same hole for the other eager faces).
  Lesson: a font made eager changes every awaiting caller, not just loading.
