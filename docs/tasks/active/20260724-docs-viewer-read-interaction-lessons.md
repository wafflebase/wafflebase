# Lessons — Docs viewer read interaction (issue #482)

## Context

Read-only docs mode disabled *all* pointer/clipboard/link interaction by
constructing no `TextEditor` at all. Fix reuses the editor's existing
machinery with a `readOnly` gate rather than duplicating selection/copy.

## Findings

- Selection highlight paint is independent of the `focused` flag (uses an
  inactive color when unfocused); the caret paints only when `focused`.
  So enabling selection in read-only just needed the pointer/copy path,
  not new render code. (`doc-canvas.ts` lines ~462 / ~598.)
- `focused` becomes true when the hidden textarea gains focus. In
  read-only we grab focus on first click so `Ctrl+C` works and the caret
  appears — matching Google-Docs viewer behavior.
- Distinguishing a link *click* from a drag: check whether the selection
  is collapsed (anchor == focus) on mouseup, no distance threshold needed.

## Review finding (self-review, fixed)

- **Enabling the pointer path in read-only re-exposed a table-edit menu.**
  Because the caret can now land in a table cell, `editor.isInTable()`
  becomes true in read-only, and `DocsTableContextMenu` (all items mutate
  the table) would open on right-click. Previously unreachable because the
  read-only editor had no pointer handling / caret at all. Fixed by bailing
  out of its `handleContextMenu` when `readOnly` — the edit-free body
  context menu then handles the right-click. Lesson: when you *enable* a
  previously-dead interaction surface, re-audit every feature that keys off
  the state that surface produces (here: caret-in-table).

## Follow-ups / open questions

- Non-blocking: viewer right-click Copy. Copy works via `Ctrl/Cmd+C`
  (issue requirement met), but the body context menu still hides its Copy
  item in read-only (`showCopy = hasSelection && !readOnly`). Now that the
  `TextEditor` (and its hidden textarea) exists in read-only, `editor.copy()`
  would work — a future PR could offer right-click Copy in the viewer.
