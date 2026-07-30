# Notes native undo — lessons (issue #604)

## Context

Migrate WaffleNotes undo/redo from CodeMirror local history to Yorkie
`doc.history`, so undo preserves peers' concurrent edits.

## Lessons

- The issue's prerequisite spike resolved cleanly: `Text.edit()` reverse
  ops are supported on `@yorkie-js/sdk` 0.7.13. The `Tree.editByPath`
  merge caveat that motivated the spike is a Tree-only limitation and
  never applied to notes, whose whole content is one `Text`.
- An empty `doc.update()` pushes nothing onto the undo stack, so
  `batch()` does not need to pre-check whether the body will mutate.
- Disabling `basicSetup`'s `history()` silently breaks vim's `u` /
  `<C-r>` too: `@replit/codemirror-vim` routes them through
  `CodeMirror.commands.undo/redo`, which call `@codemirror/commands`'
  `undo(view)` and no-op without the history extension. The static
  `CodeMirror.commands` map is read at call time, so overriding it is
  the supported-shaped hook; its `:undo` ex-command copy is snapshotted
  at module load and cannot be re-routed.
- Undo granularity changes: CM history groups keystrokes by time
  (`newGroupDelay`), Yorkie's unit is one change. One CM transaction =
  one undo unit, so undo now steps per keystroke — the same behavior
  Docs and Slides already have after their migrations.
