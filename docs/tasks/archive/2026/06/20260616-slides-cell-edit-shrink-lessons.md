# Lessons — slides cell text-edit box shrink

## What the bug taught

- When one element kind is added to a code path that branches on
  `kind`, audit **every** kind-keyed branch, not just the obvious one.
  Cell editing reused the shape/text mount path but the `growMode`
  ternary (`kind === 'shape' ? 'never' : 'auto'`) silently put cells in
  the text bucket. The matching gates (`editingGrowApplicable`, the
  commit frame-fit) had already been written as `kind === 'text'`, so
  the ternary was the lone outlier — a clear "default branch swallowed a
  new case" smell. Prefer `kind === 'text' ? … : …` (allow-list the
  auto-grow case) over `kind === 'shape' ? … : …` (deny-list one fixed
  case) so future kinds default to the safe/fixed behaviour.

## Test-env gotcha

- The slides `test-canvas-env` fake 2D context is intentionally narrow
  (methods added on demand). Rendering a `table` element through the
  editor in jsdom was new, so `setLineDash`/`getLineDash` were missing.
  When a jsdom editor test newly renders an element kind, expect to
  extend the fake ctx.

## Process

- TDD reproduced the bug precisely: the red assertion was literally
  `expected 'auto' to be 'never'`, which both proves the diagnosis and
  documents the fix in one line.
