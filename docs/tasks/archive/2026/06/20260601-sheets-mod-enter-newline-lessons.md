# Lessons: Sheets Mod+Enter newline

**Date:** 2026-06-01

## What worked

- `handleEditorKeydown` in `worksheet.ts` already dispatches both
  the in-grid `CellInput` and the formula bar input through a
  `source` parameter, so the new binding could be scoped to
  `cellInput` only.
- Combining the new combo into the existing rule with an `||` kept
  the diff small and reused the existing `runKeyRules` ordering.

## Pitfalls avoided

- `FormulaBar` is a single-line `whiteSpace: nowrap` element
  (`packages/sheets/src/view/formulabar.ts`). The first revision
  let `Mod+Enter` fire on both surfaces, so `Cmd+Enter` in the
  formula bar would silently inject a `<br>` into a nowrap div
  instead of finishing the edit. Self-review caught this; the rule
  now guards on `source === 'cellInput'`. (`Alt+Enter` keeps its
  pre-existing formula-bar behavior; cleaning that up is a
  separate concern.)
- The current `Alt+Enter` rule does not pin `shift: false`, so
  `Alt+Shift+Enter` also inserts a newline. Copying that pattern for
  `Mod+Enter` would have changed `Cmd+Shift+Enter` from
  "finish editing & move up" (the existing shift-reverses-Enter
  behavior) to "insert newline" — a silent regression. The new
  rule explicitly constrains `shift: false`.
- `keyEquals` ignores modifiers, so the plain-Enter rule below
  would have swallowed `Mod+Enter` if we had added the new rule
  beneath it. `runKeyRules` short-circuits on first match — order
  matters.

## Reference

- macOS Korean IME reserves `Option` for Hangul→Hanja conversion,
  which made `Alt+Enter` unreliable while composing Korean.
- Google Sheets ships `Cmd+Enter` as the macOS-friendly newline; we
  follow that precedent for parity.
