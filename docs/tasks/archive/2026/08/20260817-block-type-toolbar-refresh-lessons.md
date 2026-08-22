# Lessons — block-type toolbar refresh (#792)

## The toolbar has exactly one refresh trigger

Everything selection-derived in the docs toolbar hangs off
`editor.onCursorMove`. A mutation that does not move the caret is therefore
invisible to the toolbar unless it synthesises a fire — which is what
`notifyStyleApplied()` exists for. When adding a new `EditorAPI` mutation that
changes anything the toolbar displays, ending it with `notifyStyleApplied()` is
part of the contract, not an optimisation.

## `requestRender` is a notification path, not just a paint

The issue read `text-editor.ts` in isolation and concluded the keyboard
shortcut was equally stale. It is not: the docs host wires `requestRender` to
`renderWithScroll`, which fires the cursor-move callbacks after painting. A
"no notification here" conclusion drawn from one file is only valid after the
host's wiring of the injected callbacks is checked — in this codebase the
`TextEditor` receives its render functions from `editor.ts`, and two of the
three variants (`renderWithScroll`, `renderCursorMove`) notify.
