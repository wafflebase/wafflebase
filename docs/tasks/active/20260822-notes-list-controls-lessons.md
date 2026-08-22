# Lessons — notes list controls + bare `[ ]` checkboxes

## What we learned

- `markdown-it-task-lists`' `label: true` option is actively harmful once the
  checkboxes are interactive. The `<label>` wraps the item text *and* the
  checkbox, so a click on the text is forwarded by the browser to the input
  inside it — the delegated handler sees the same tick twice (jsdom reproduces
  this, and `preventDefault()` on the outer click did not suppress it there).
  Dropping the wrapper makes the item a single click target with one event.
- Rewriting a whole line to add a list marker moves the caret to the end of
  it: CodeMirror maps a position inside a replaced range to the end of the
  insertion. Replacing only the *marker prefix* (`line.from` →
  `line.to - content.length`) leaves the caret where the user left it, which is
  what makes the toolbar toggles usable mid-word.
- One indent step cannot be a fixed two spaces. A child of `1. a` needs three
  columns to nest under it, so the step is the parent item's content column.
  Getting this wrong produces markdown that looks nested in the source and
  renders flat.
- A note can be non-writable two ways: `EditorState.readOnly`, or a
  non-editable view (`EditorView.editable.of(false)`), which is what
  `initialize(..., readOnly)` actually sets. A guard that checks only the first
  is a false negative on every share-link mount.
- Sizing "can this indent?" off the *topmost* selected list line and shifting
  the whole block by that one step is what preserves nesting inside a
  multi-line selection. Deciding per line would leave a child behind when its
  parent moves.

## Follow-ups

- A bare `[ ]` that arrives by paste (rather than typed) is still plain text —
  the input rule normalizes the source as it is typed instead of the preview
  rendering hyphen-less boxes. Rendering them would need a markdown-it rule and
  would make the preview disagree with every other markdown reader.
- Ordered lists are numbered only within the selection; a list that continues
  past it is not renumbered.
