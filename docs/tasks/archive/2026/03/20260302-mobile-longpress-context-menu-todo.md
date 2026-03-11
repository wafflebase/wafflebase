# Mobile Long-Press Context Menu

Add a long-press gesture to show a context menu on mobile for common cell
operations (copy, paste, cut, delete).

## Context

Mobile users currently have no way to access copy/paste/cut operations.
Google Sheets provides a long-press context menu for this purpose.

## Tasks

- [x] Define long-press gesture detection in `use-mobile-sheet-gestures.ts`
  - Hold threshold: ~500ms without movement
  - Movement tolerance: ~10px to distinguish from pan
- [x] Create `MobileContextMenu` component (floating menu near touch point)
  - Actions: Cut, Copy, Paste, Delete contents
  - Position above or below touch point depending on available space
- [x] Wire context menu to spreadsheet clipboard operations
- [x] Dismiss context menu on tap outside, scroll, or selection change
- [x] Handle paste via Clipboard API (`navigator.clipboard.readText()`)
- [x] Add visual regression baseline for context menu
- [x] Run `pnpm verify:fast` and confirm pass
