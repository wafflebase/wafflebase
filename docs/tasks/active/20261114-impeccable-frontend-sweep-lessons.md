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
- Round 2 (design fit/blast radius + superpowers code review): 2 panel
  blockers. test-adequacy — the folder/mixed confirm-delete path was never
  clicked through; added tests for folder-only (no Undo) and mixed selection
  (documents trashed, Undo restores only them). blast-radius — dropping the
  app-wide brand `<link>` let a "More fonts" preview inject a `&text=` subset
  of Fraunces / JetBrains Mono that strips glyphs from the chrome; brand
  families now load the full brand sheet instead of a subset. The code
  reviewer's Important items were fixed too: the homepage demo now renders
  while checking (no layout shift on wafflebase.io), `TemplateGallery` loads
  the brand faces itself, avatar initials go through `avatarInitials`
  everywhere, and "Delete forever" no longer claims the Yorkie content is
  destroyed. Also: `deleteDocument` is silent and `discardDocument` reuses it,
  the `focus-ring` outline survives forced-colors, toggles get 44px width on
  touch, the trash doc names the unrevokable-link case.
  Lesson: removing a global stylesheet breaks every module that assumed it —
  grep for the file name in comments (`index.html`) before deleting a link.
