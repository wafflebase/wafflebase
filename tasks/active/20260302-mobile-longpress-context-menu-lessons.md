# Mobile Long-Press Context Menu — Lessons

## Architecture

- The `Spreadsheet` facade class had no public clipboard methods. Copy/cut/
  paste/removeData were private in `Worksheet`, only reachable via keyboard
  shortcuts. Adding public methods to `Spreadsheet` was necessary for the
  React layer to invoke clipboard operations.
- This creates duplication between `Worksheet` private methods and
  `Spreadsheet` public methods. A future refactoring could extract shared
  helpers or have `Worksheet` delegate to `Spreadsheet`.

## Gesture Design

- Long-press timer (500ms) coexists with existing pan and double-tap
  detection cleanly. The timer is cleared on any movement beyond 10px,
  on multi-touch, on touch-end, and on touch-cancel.
- Using `startX`/`startY` (initial touch point) for the long-press
  callback is the correct UX — the context menu appears where the user
  first touched, not where their finger drifted.

## Clipboard on Mobile

- Mobile browsers may deny clipboard access without a user gesture.
  `copy()` and `cut()` need try/catch to avoid uncaught rejections.
- `navigator.clipboard.read()` can read both `text/html` and `text/plain`
  formats. Falls back to `readText()` when `read()` is not permitted.

## Accessibility

- Added `role="menu"` on container and `role="menuitem"` on buttons
  for screen reader support, matching ARIA menu pattern.
