# Sheets: Mod+Enter for in-cell newline

**Owner:** @hackerwins
**Date:** 2026-06-01

## Why

`Alt+Enter` inserts a newline inside a cell, matching Excel and Google
Sheets cross-platform. On macOS with the Korean IME enabled, however,
the `Option` modifier triggers the system Hangul → Hanja conversion
dropdown, so users cannot reliably insert a newline while typing
Korean. Google Sheets on macOS accepts `Cmd+Enter` as an additional
newline shortcut, which avoids the IME conflict because Korean IMEs
do not intercept `Cmd`/`Ctrl`.

## Scope

- Add `Mod+Enter` (Cmd on macOS, Ctrl on Windows/Linux) as a second
  in-cell newline shortcut alongside the existing `Alt+Enter`.
- Apply to both the in-grid cell input and the formula bar input
  (`handleEditorKeydown` already dispatches both).
- Keep `Shift+Mod+Enter` on the existing "finish editing & move up"
  path so the legacy navigation behavior is unchanged.

## Plan

- [x] Locate the key rule for `Alt+Enter` in
  `packages/sheets/src/view/worksheet.ts` (`handleEditorKeydown`).
- [x] Extend the rule to also match `Mod+Enter` (Cmd/Ctrl, no Shift).
- [x] Update `docs/design/sheets/sheet.md` to note the new shortcut.
- [x] `pnpm verify:fast` green.

## Out of scope

- Changing existing `Alt+Enter` behavior.
- Touching docs / slides newline shortcuts.
- Array-formula `Cmd+Shift+Enter` (we don't have CSE formulas).
