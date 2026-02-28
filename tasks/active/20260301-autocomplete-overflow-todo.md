# Autocomplete Dropdown Overflow Fix

## Problem
Typing `=s` shows 34 function suggestions, causing the dropdown to extend
beyond the visible screen area.

## Tasks
- [x] Investigate current autocomplete implementation
- [x] Add `maxHeight: 300px` to dropdown container
- [x] Change `overflow: hidden` to `overflowY: auto`
- [x] Add `scrollToSelected()` for keyboard navigation
- [x] Verify all tests pass (`pnpm verify:fast` — 833/833)

## Review
- Single file change: `packages/sheet/src/view/autocomplete.ts`
- Dropdown now caps at ~10 visible items with scroll
- Keyboard navigation scrolls selected item into view
