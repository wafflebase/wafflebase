# Impeccable frontend sweep — lessons

## Setup
- `:5173` was serving the `waffledocs` checkout; the critique ran against a
  second Vite on `:5181` from this tree.
- Parallel agents share one working tree, so each owns a disjoint set of
  files; shared primitives (`userFacingError`, `focus-ring`) were written
  first so nobody had to edit a common file mid-flight.

## Review rounds
