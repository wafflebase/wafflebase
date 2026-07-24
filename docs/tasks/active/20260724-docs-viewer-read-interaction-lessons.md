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

## Follow-ups / open questions

- (fill in during review)
